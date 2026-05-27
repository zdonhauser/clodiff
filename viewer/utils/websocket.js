/**
 * createWebSocket(url, { onMessage, onStatusChange })
 * Returns: { send(data), close() }
 * Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
 * onStatusChange called with "connected" | "reconnecting" | "disconnected"
 */
export function createWebSocket(url, { onMessage, onStatusChange } = {}) {
  let ws = null
  let reconnectDelay = 1000
  let intentionallyClosed = false
  let reconnectTimer = null

  function connect() {
    try {
      ws = new WebSocket(url)
    } catch (err) {
      scheduleReconnect()
      return
    }

    ws.addEventListener("open", () => {
      reconnectDelay = 1000
      onStatusChange?.("connected")
    })

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage?.(data)
      } catch {
        // Ignore non-JSON messages
      }
    })

    ws.addEventListener("close", () => {
      if (!intentionallyClosed) {
        onStatusChange?.("reconnecting")
        scheduleReconnect()
      } else {
        onStatusChange?.("disconnected")
      }
    })

    ws.addEventListener("error", () => {
      // close event will fire after error, handle reconnect there
    })
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      connect()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === "string" ? data : JSON.stringify(data))
    }
  }

  function close() {
    intentionallyClosed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
  }

  // Start connecting
  connect()

  return { send, close }
}
