# Video Composer V1

A mobile-first, browser-local video composer. Video files are never uploaded: importing, trimming, stabilization analysis, reframing, text rendering, audio routing, and export all happen in the browser.

## Run locally

Serve this directory with any static web server, then open it in a modern browser. HTTPS (or localhost) is required for PWA installation.

## Architecture

- Buildless HTML/CSS/JavaScript for a clean GitHub backup path.
- Canvas preview and real-time MediaRecorder export at 25 fps.
- Low-resolution luminance proxy for stabilization analysis.
- Service worker and web app manifest for PWA installability.

The browser must be able to decode the selected MP4/MOV. Export uses the first MediaRecorder format supported by the current browser; this can be MP4 on Safari or WebM on Chromium browsers.
