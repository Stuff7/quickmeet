package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/stuff7/quickmeet/server"
)

func main() {
	newpath := filepath.Join(".", "logs")
	if err := os.MkdirAll(newpath, os.ModePerm); err != nil {
		log.Fatal(err)
	}

	logFile, err := os.OpenFile("logs/app.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0666)
	if err != nil {
		log.Fatal(err)
	}

	defer logFile.Close()

	log := log.New(logFile, "", log.Lmsgprefix|log.Ldate|log.Ltime|log.Lshortfile)
	server := server.New(log)

	server.Run()
}
