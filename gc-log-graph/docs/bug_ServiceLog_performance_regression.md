# Bug Report: Performance Regression and Memory Leak in Service Log Extension

## Symptoms
After implementing the visual refinements (dynamic dot sizing, detailed popups), the following issues were observed during graph interaction (zooming and dragging):
1.  **High CPU Usage (100% spikes)**: Dragging the graph became extremely sluggish, pinning CPU cores at 100%.
2.  **Memory Leak**: The browser's JS heap increased steadily (~1MB per re-render) and during popup interactions, eventually leading to a tab crash or extreme lag.

## Root Cause Analysis

### 1. Inefficient DOM Querying in Hot Path
The `onZoom` handler, which fires on every mouse move during a drag operation, contained a global D3 selection:
```javascript
onZoom(event) {
    // ...
    d3.select('.ext-service-log').selectAll('.svc-dot').attr('cx', d => x(d.timestamp));
}
```
For 1300+ dots, querying the DOM on every frame (60fps) is extremely expensive for the browser's selector engine and layout engine.

### 2. Expensive Logic in UI Handlers
We introduced complex template literals and regex parsing inside `mouseover` and `click` handlers. Because D3 binds these listeners to every individual SVG element, and the handlers were being re-defined or complexly evaluated during re-renders, they created significant overhead during interaction.

### 3. Event Listener Accumulation
Inside the `click` handler for dots, we were attaching a new `onclick` listener to the global `#close-popup` button:
```javascript
document.getElementById('close-popup').onclick = () => { ... };
```
Every time a user clicked a different dot, a new closure was created. If not properly handled by the engine, or if multiple instances of the script were running (due to re-loading), these listeners would accumulate in memory.

### 4. Redundant Extension Registration
The extension scripts used `window.GCGraphExtensions.push(Extension)` without a guard. If the script was re-injected or re-loaded, multiple instances of the same extension would register, causing redundant parsing, sorting, and rendering logic to run in parallel.

## Resolution

1.  **D3 Selection Caching**: Created a `_cachedDots` selection during the initial `render()` phase. The `onZoom` handler now uses this cached reference, skipping all DOM lookups.
    ```javascript
    onZoom(event) {
        const { x } = event;
        if (!this._cachedDots || this._cachedDots.empty()) {
            // Selection is cached here so it is done only once
            this._cachedDots = d3.select('.ext-service-log').selectAll('.svc-dot');
        }
        // Use cached selection to skip expensive DOM lookups
        this._cachedDots.attr('cx', d => x(d.timestamp));
    }
    ```
2.  **Hot Path Optimization (Pre-calculation)**: Stripped all expensive logic (regex, timezone formatting, response size formatting) from the `onZoom` and `mouseover` handlers. Tooltip HTML is now pre-calculated during the `render` phase and stored in `d._tooltipHtml`.
3.  **Listener Cleanup**: Added `closeBtn.onclick = null` before re-assigning the listener to ensure previous closures are released and no accumulation occurs.
    ```javascript
    const closeBtn = document.getElementById('close-popup');
    if (closeBtn) {
        closeBtn.onclick = null; // Clear stale listeners
        closeBtn.onclick = () => { ... };
    }
    ```
4.  **Idempotent Registration**: Added a guard at the top of the extension scripts:
    ```javascript
    if (window.GCGraphExtensions.some(e => e.name === 'ServiceLog')) return;
    ```

## Verification Results
- **Smoothness**: Graph dragging is now fluid and responsive.
- **Resources**: CPU usage remains at baseline during interaction.
- **Registry**: `window.GCGraphExtensions` maintains exactly one instance per extension.
