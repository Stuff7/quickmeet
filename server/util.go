package server

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"unsafe"
)

func (self *Server) logDbg(format string, v ...any) {
	if !self.silent {
		fmt.Printf("[DEBUG] "+format+"\n", v...)
	}
	self.log.Printf("[DEBUG] "+format+"\n", v...)
}

func (self *Server) logErr(format string, v ...any) {
	if !self.silent {
		fmt.Printf("[ERROR] "+format+"\n", v...)
	}
	self.log.Printf("[ERROR] "+format+"\n", v...)
}

func (self *Server) logFatal(format string, v ...any) {
	if !self.silent {
		fmt.Printf("[FATAL] "+format+"\n", v...)
	}
	self.log.Fatalf("[FATAL] "+format+"\n", v...)
}

func generateID[T any](ptr *T) string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic("Failed to generate ID: " + err.Error())
	}

	ptrAddr := fmt.Sprintf("%x", uintptr(unsafe.Pointer(ptr)))

	return hex.EncodeToString(bytes[:]) + ptrAddr
}

func extractPointer[T any](id string) (*T, error) {
	if len(id) < 32 {
		return nil, fmt.Errorf("Invalid ID format")
	}

	ptrHex := id[32:]

	ptrInt, err := strconv.ParseUint(ptrHex, 16, 64)
	if err != nil {
		return nil, err
	}

	ptr := uintptr(ptrInt)
	return (*T)(unsafe.Add(nil, ptr)), nil
}

type BasicMessage = struct {
	Type      string `json:"type"`
	Id        string `json:"id"`
	Name      string `json:"name,omitempty"`
	OwnerName string `json:"ownerName,omitempty"`
	RoomId    string `json:"roomId"`
}

type ClientMessage = struct {
	Type   string `json:"type"`
	Name   string `json:"name,omitempty"`
	RoomId string `json:"roomId"`
}

func (self *Server) addClient(conn *net.Conn, r *http.Request) {
	id := generateID(conn)
	joinMsg := BasicMessage{
		Type: "server:join",
		Id:   id,
		Name: fmt.Sprintf("Anon#%s", id[:4]),
	}
	joinMsg.RoomId = r.URL.Query().Get("room")
	roomConn, err := extractPointer[net.Conn](joinMsg.RoomId)
	roomOwner := Client{}

	if err == nil {
		roomOwner = self.clients[roomConn]
	} else {
		self.logErr("Extract connection pointer: %v", err)
	}

	if err != nil || roomOwner.id == "" || roomOwner.isRoomFull.Load() {
		joinMsg.RoomId = id
		self.clients[conn] = Client{id: id, roomId: joinMsg.RoomId, alive: true, isRoomFull: &atomic.Bool{}}

		if err == nil && roomOwner.id != "" {
			self.sendServerMessage(conn, BasicMessage{Type: "room:full", Id: id, RoomId: joinMsg.RoomId})
		}
	} else {
		roomOwner.isRoomFull.Store(true)
		self.clients[conn] = Client{id: id, roomId: joinMsg.RoomId, alive: true, isRoomFull: roomOwner.isRoomFull}
		joinMsg.OwnerName = roomOwner.name
		self.sendServerMessage(roomConn, BasicMessage{
			Type:   "room:join",
			Id:     id,
			RoomId: joinMsg.RoomId,
			Name:   fmt.Sprintf("Anon#%s", id[:4]),
		})
	}

	self.logDbg("%s: WebSocket connection established", self.clients[conn].id)
	self.sendServerMessage(conn, joinMsg)
}

func (self *Server) sendServerMessage(conn *net.Conn, data any) {
	msg, err := json.Marshal(data)
	if err != nil {
		self.logErr("%s: Error parsing ws message: %v", self.clients[conn].id, err)
		return
	}

	if err := writeFrame(*conn, string(msg)); err != nil {
		self.logErr("%s: Error sending ws message: %v", self.clients[conn].id, err)
		return
	}
}

func (self *Server) echoServerMessage(conn *net.Conn, data BasicMessage) {
	message, err := json.Marshal(data)
	if err != nil {
		self.logErr("Invalid server message: %v", err)
		return
	}

	for c := range self.clients {
		if c == conn || self.clients[c].roomId != data.RoomId {
			continue
		}

		if err := writeFrame(*c, string(message)); err != nil {
			self.logErr("Error writing frame: %v", err)
			return
		}
	}
}

func isWebSocket(r *http.Request) bool {
	connectionHeader := r.Header.Get("Connection")
	upgradeHeader := r.Header.Get("Upgrade")
	return strings.Contains(strings.ToLower(connectionHeader), "upgrade") && strings.ToLower(upgradeHeader) == "websocket"
}

func sendPing(conn net.Conn) error {
	pingFrame := []byte{0x89, 0x00}
	_, err := conn.Write(pingFrame)
	return err
}

func GetLocalAddr() string {
	addrs, err := net.InterfaceAddrs()

	if err == nil {
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}

	return "127.0.0.1"
}

func computeAcceptKey(key string) string {
	hash := sha1.New()
	hash.Write([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(hash.Sum(nil))
}
