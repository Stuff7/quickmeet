package server

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type Client struct {
	id         string
	name       string
	roomId     string
	alive      bool
	isRoomFull *atomic.Bool
}

type Server struct {
	log     *log.Logger
	fs      http.Handler
	clients map[*net.Conn]Client
	port    string
	dir     string
	silent  bool
}

func New(logger *log.Logger) Server {
	port := flag.Int("port", 8080, "Port to listen")
	dir := flag.String("dir", "public", "Directory to serve")
	silent := flag.Bool("silent", false, "Do not log requests")

	flag.Parse()

	return Server{
		log:     logger,
		fs:      http.FileServer(http.Dir(*dir)),
		clients: make(map[*net.Conn]Client),
		port:    strconv.Itoa(*port),
		dir:     *dir,
		silent:  *silent,
	}
}

func (self *Server) Run() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		var isWs = isWebSocket(r)
		m := r.Method
		if isWs {
			m = "WS"
		}

		self.logDbg(
			"%s %s %s %s | %s",
			m,
			r.URL.Path,
			r.Proto,
			r.RemoteAddr,
			r.Header.Get("User-Agent"),
		)

		if isWs {
			self.handleWebSocket(w, r)
			return
		}

		self.fs.ServeHTTP(w, r)
	})

	fmt.Printf(
		"\x1b[1mServing: %s\n\x1b[38;5;159mhttp://localhost:%s\n\x1b[38;5;158mhttp://%s:%s\n\x1b[38;5;225mCtrl-C\x1b[0m to exit\n",
		self.dir,
		self.port,
		GetLocalAddr(),
		self.port,
	)

	go self.monitorConnections()

	self.logFatal("%v", http.ListenAndServe(":"+self.port, nil))
}

func (self *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "webserver doesn't support hijacking", http.StatusInternalServerError)
		return
	}

	conn, _, err := hijacker.Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	defer conn.Close()

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return
	}

	acceptKey := computeAcceptKey(key)
	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n"

	_, err = conn.Write([]byte(response))
	if err != nil {
		return
	}

	self.addClient(&conn, r)

	for {
		currClient := self.clients[&conn]
		message, err := self.readFrame(&conn)
		if err != nil {
			self.logDbg("WebSocket connection closed %s %s", currClient.id, err)
			currClient.isRoomFull.Store(false)
			self.echoServerMessage(&conn, BasicMessage{Type: "server:leave", Id: currClient.id, RoomId: currClient.roomId, Name: currClient.name})
			delete(self.clients, &conn)
			return
		}

		if message == "" {
			continue
		}

		var parsedMsg ClientMessage
		if err := json.Unmarshal([]byte(message), &parsedMsg); err != nil {
			self.logErr("Invalid client message: %v", err)
			return
		}

		if parsedMsg.Type == "action:rename" {
			currClient.name = parsedMsg.Name
			self.clients[&conn] = currClient
		}
		self.echoClientMessage(&conn, parsedMsg.RoomId, message)
	}
}

func (self *Server) echoClientMessage(conn *net.Conn, roomId string, message string) {
	for c := range self.clients {
		if c == conn || self.clients[c].roomId != roomId {
			continue
		}

		if err := writeFrame(*c, message); err != nil {
			self.logErr("Error writing frame: %v", err)
			return
		}
	}
}

func (self *Server) monitorConnections() {
	for {
		time.Sleep(30 * time.Second)
		if len(self.clients) == 0 {
			continue
		}

		for conn, c := range self.clients {
			if !c.alive {
				self.logErr("No pong from %s. %v", c.id, self.clients)
				(*conn).Close()
				continue
			}
			c.alive = false
			self.clients[conn] = c
		}

		for conn, client := range self.clients {
			err := sendPing(*conn)
			if err != nil {
				self.logErr("Ping failed for %s: %v", client.id, err)
				(*conn).Close()
			}
		}
	}
}

func (self *Server) readFrame(conn *net.Conn) (string, error) {
	c := *conn
	header := make([]byte, 2)
	if _, err := io.ReadFull(c, header); err != nil {
		return "", err
	}

	opcode := header[0] & 0x0F
	isMasked := (header[1] & 0x80) != 0
	payloadLen := int(header[1] & 0x7F)

	client := self.clients[conn]

	// Control frames
	switch opcode {
	case 0xA: // PONG
		client.alive = true
		self.clients[conn] = client

	case 0x9: // PING
		self.logDbg("[%s] Received PING frame, sending PONG", client.id)
		client.alive = true
		self.clients[conn] = client

		var maskKey []byte
		if isMasked {
			maskKey = make([]byte, 4)
			if _, err := io.ReadFull(c, maskKey); err != nil {
				return "", err
			}
		}

		// PING frames can have a payload
		payload := make([]byte, payloadLen)
		if payloadLen > 0 {
			if _, err := io.ReadFull(c, payload); err != nil {
				return "", err
			}
			if isMasked {
				for i := range payload {
					payload[i] ^= maskKey[i%4]
				}
			}
		}

		// Send the same payload back in the PONG
		pongFrame := append([]byte{0x8A, byte(len(payload))}, payload...)
		_, err := c.Write(pongFrame)
		return "", err

	case 0x8: // CLOSE
		closeCode := uint16(1000) // Normal Closure
		reason := ""

		if payloadLen >= 2 {
			closeCodeBytes := make([]byte, 2)
			if _, err := io.ReadFull(c, closeCodeBytes); err != nil {
				return "", err
			}
			closeCode = binary.BigEndian.Uint16(closeCodeBytes)

			if payloadLen > 2 {
				reasonBytes := make([]byte, payloadLen-2)
				if _, err := io.ReadFull(c, reasonBytes); err != nil {
					return "", err
				}
				reason = string(reasonBytes)
			}
		}

		self.logDbg("Received close frame: Code %d, Reason: %s", closeCode, reason)
		c.Write([]byte{0x88, 0x02, byte(closeCode >> 8), byte(closeCode & 0xFF)})
		c.Close()
		return "", fmt.Errorf("connection closed by client")
	}

	// Text/Binary frames
	var extendedLen int64
	if payloadLen == 126 {
		lenBytes := make([]byte, 2)
		if _, err := io.ReadFull(c, lenBytes); err != nil {
			return "", err
		}
		extendedLen = int64(binary.BigEndian.Uint16(lenBytes))
	} else if payloadLen == 127 {
		lenBytes := make([]byte, 8)
		if _, err := io.ReadFull(c, lenBytes); err != nil {
			return "", err
		}
		extendedLen = int64(binary.BigEndian.Uint64(lenBytes))
	} else {
		extendedLen = int64(payloadLen)
	}

	var maskKey []byte
	if isMasked {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(c, maskKey); err != nil {
			return "", err
		}
	}

	payload := make([]byte, extendedLen)
	if _, err := io.ReadFull(c, payload); err != nil {
		return "", err
	}

	if isMasked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}

	return string(payload), nil
}

func writeFrame(conn net.Conn, message string) error {
	payload := []byte(message)
	payloadLen := len(payload)
	frame := []byte{0x81}

	if payloadLen <= 125 {
		frame = append(frame, byte(payloadLen))
	} else if payloadLen <= 0xFFFF {
		frame = append(frame, 0x7E)
		lenBytes := make([]byte, 2)
		binary.BigEndian.PutUint16(lenBytes, uint16(payloadLen))
		frame = append(frame, lenBytes...)
	} else {
		frame = append(frame, 0x7F)
		lenBytes := make([]byte, 8)
		binary.BigEndian.PutUint64(lenBytes, uint64(payloadLen))
		frame = append(frame, lenBytes...)
	}

	frame = append(frame, payload...)
	_, err := conn.Write(frame)

	return err
}
