# Micro:Bit Face Tracking Controller

This is a browser web app that tracks a user's face and sends BBC Micro:Bit UART data over Web Bluetooth.

## Data format

The app sends a 19-digit payload followed by a newline, matching the Lo-fi Robot app UART format:

```text
XXYYZZYYPPMMEERRRSF
```

Field order:

```text
X, Y, Distance, Yaw, Pitch, Mouth, Left eye, Right eye, Roll, Smile, Face visibility
```

Two-digit values are clamped to `00-99`. Roll and smile are `0-9`. Face visibility is `0-1`.

When Bluetooth sending is enabled, the app sends the current 19-digit payload plus newline at 10 updates per second, even when the values have not changed.

## Browser support

Camera tracking uses `getUserMedia`, which works across modern desktop and mobile browsers when served from `localhost` or HTTPS.

Bluetooth uses Web Bluetooth, which works best in Chrome or Edge on desktop and many Android browsers. iPhone Safari still does not expose normal Web Bluetooth, so iPhone users have three practical paths:

1. Use the iPhone for tracking only, then relay values through a laptop/Android device that connects to the Micro:Bit.
2. Try an iOS browser app that wraps CoreBluetooth and exposes Web Bluetooth, such as Bluefy or WebBLE. Compatibility depends on the browser app.
3. Build a small native iOS helper app later using CoreBluetooth.

## Running locally

On Windows, double-click Start Face Tracking App.bat. Keep the server window open while using the app.

Do not double-click index.html; camera, Bluetooth, and model loading need localhost or HTTPS.

Serve the folder from a local web server, then open it in Chrome or Edge:

```powershell
python -m http.server 5173
```

Then visit:

```text
http://localhost:5173
```

For another phone on the same Wi-Fi network, use HTTPS or a tunneling tool because phone browsers usually block camera access from plain HTTP pages that are not localhost.
