# quickmeet
Quick 1 on 1 video call and chat

# Build

```bash
npm i
npm run server:build
npm run client:build
```

# Run

- You'll need an [https proxy](https://github.com/Stuff7/https-proxy) pointing to the server port

```bash
https-proxy -port 8080 -https-port 8443
build/quickmeet -dir dist
```
