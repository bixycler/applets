# Bug Report: Access Log Disappearance ("Heisenberg" Shift)

## Symptoms
- After loading a new log file, the "Access Log" extension plots (bars, dots, rates) are invisible despite being selected.
- Toggling the extension selection (switching to "None" and back) restores visibility.
- **DOM inspection** reveals that the `<g class="ext-access-log">` bounding box has an `x` coordinate of roughly **9834px**, placing it far off-screen to the right. Correct rendering should be near `x=50px`.

<details>
<summary>View Debug Logs (Success vs. Ghost Shift)</summary>

```
# First time loading log after app start:
access_log.js:18 [AccessLog] Reset.
access_log.js:141 [AccessLog] render() called. Events to draw: 726
access_log.js:174 [AccessLog] render() scale diagnostics:
access_log.js:175   - x.domain: [1762693203752, 1762693573438]
access_log.js:176   - x.range:  [0, 1469]
access_log.js:177   - Event 0 time: 1762693196500 (2025-11-09T12:59:56.500Z)
access_log.js:178   - Event 0 x(time): -28.816855385381107
access_log.js:182 [AccessLog] Group DOM Position (Initial): {x: 180, left: 180, width: 50, height: 50, top: 324.875}
# The Access Log graph shows correctly.
> debugAccess()
access_log.js:196 --- AccessLog GLOBAL DEBUG ---
access_log.js:197 Group DOM Position: DOMRect {x: 49.183143615722656, y: 224.875, width: 927.0771484375, height: 187, top: 224.875, …}
access_log.js:198 Group BBox: SVGRect {x: -30.81685447692871, y: 0, width: 927.0771484375, height: 187}
access_log.js:199 First Bar x1: -28.816855385381107
access_log.js:200 Current Domain: (2) [1762693203752, 1762693573438]
access_log.js:201 Calculated X0 now: -28.816855385381107
# The position is correct, as shown in the debug log.

# Next, load another log file:
access_log.js:18 [AccessLog] Reset.
access_log.js:141 [AccessLog] render() called. Events to draw: 218
access_log.js:174 [AccessLog] render() scale diagnostics:
access_log.js:175   - x.domain: [1762416010182, 1762419454491]
access_log.js:176   - x.range:  [0, 1469]
access_log.js:177   - Event 0 time: 1762416081500 (2025-11-06T08:01:21.500Z)
access_log.js:178   - Event 0 x(time): 30.417172791407506
access_log.js:182 [AccessLog] Group DOM Position (Initial): {x: 180, left: 180, width: 50, height: 50, top: 324.875}
# The Access Log graph does NOT show.
> debugAccess()
access_log.js:196 --- AccessLog GLOBAL DEBUG ---
access_log.js:197 Group DOM Position: DOMRect {x: -1101106.75, y: 224.875, width: 1101336.75, height: 187, top: 224.875, …}
access_log.js:198 Group BBox: SVGRect {x: -1101186.75, y: 0, width: 1101336.75, height: 187}
access_log.js:199 First Bar x1: -1101184.757302143
access_log.js:200 Current Domain: (2) [1762416010182, 1762419454491]
access_log.js:201 Calculated X0 now: 30.417172791407506
# The x-position is shifted far away, as shown in the debug log.

# Now, just switch extension to "None" and back:
access_log.js:141 [AccessLog] render() called. Events to draw: 218
access_log.js:174 [AccessLog] render() scale diagnostics:
access_log.js:175   - x.domain: [1762416010182, 1762419454491]
access_log.js:176   - x.range:  [0, 1469]
access_log.js:177   - Event 0 time: 1762416081500 (2025-11-06T08:01:21.500Z)
access_log.js:178   - Event 0 x(time): 30.417172791407506
access_log.js:182 [AccessLog] Group DOM Position (Initial): {x: 180, left: 180, width: 50, height: 50, top: 324.875}
> debugAccess()
access_log.js:196 --- AccessLog GLOBAL DEBUG ---
access_log.js:197 Group DOM Position: DOMRect {x: 108.41717529296875, y: 224.875, width: 1473.827880859375, height: 187, top: 224.875, …}
access_log.js:198 Group BBox: SVGRect {x: 28.417173385620117, y: 0, width: 1473.827880859375, height: 187}
access_log.js:199 First Bar x1: 30.417172791407506
access_log.js:200 Current Domain: (2) [1762416010182, 1762419454491]
access_log.js:201 Calculated X0 now: 30.417172791407506
# The position is corrected, as shown in the debug log.
```

</details>

## Trials & Errors
| Attempt | Change | Description / Rationale | Result |
| :--- | :--- | :--- | :--- |
| 1 | Unique `clip-path` IDs | Appended `Date.now()` to IDs. Suspected browser was reuse-caching clip shapes across re-renders. | No effect. |
| 2 | Scoped D3 selections | Used `this._extGroup.selectAll`. Aimed to prevent "leaks" where updates hit stale DOM nodes from previous renders. | No more "ghost" selections, but shift persists. |
| 3 | Forced DOM reflow | Called `getBoundingClientRect()`. Checked if the layout engine was "stuck" on the first frame of file load. | No effect. |
| 4 | Explicit `translate(0,0)` | Added `transform` attribute to `<g>`. Rule out inherited or "sticky" CSS transforms on the group. | No effect. |
| 5 | **Red Box Diagnostic** | Added a hardcoded `rect` at `x=100`. **Binary Test**: Proved the group's coordinate system is correct while data is shifted. | **Crucial Reveal**: Coordinate system OK. |
| 6 | **Numerical Diagnostic** | Logged raw epoch timestamps vs `x.domain()` and DOM attributes via `debugAccess()`. | **Smoking Gun**: First bar `x1` was `-1101186` while code logged `30`. Stale scales were overwriting NEW nodes. |

## Conclusions
1. **SVG Transforms are Healthy**: The container group and the coordinate system are mapped correctly to the screen. 
2. **Data Mapping is Broken (Intermittently)**: The issue lies in a race condition where a stale `zoomed` handler from a previous file load overwrites the new DOM.
3. **The "Heisenberg" Nature**: Because the race condition depends on a 750ms transition, it only manifests if the new file renders quickly enough to be hit by the tail end of the old transition.

## Resolution
The bug was a **Race Condition** between a 750ms zoom transition and the new file render:
1. `handleFileUpload` triggered a `resetZoom()` transition (using `d3.transition().duration(750)`) on the OLD SVG.
2. `renderChart` quickly cleared the container and created the NEW SVG.
3. The OLD transition kept firing `zoomed` events for the remainder of its 750ms life.
4. The OLD `zoomed` handler (carrying the stale `xOriginal` scale from the *previous* file) used a global D3 selector (`.ext-access-log`) which found the NEW extension group and updated its `x1/current` attributes with wildly incorrect coordinates (shifting it by ~1.1M pixels).

**Fixed by:**
- Removing the redundant and risky `resetZoom()` transition during file upload.
- Implementing a **Strict Cleanup** in `renderChart`: `d3.select(chartContainer).selectAll("svg").interrupt().on(".zoom", null)`. This kills all pending transitions and removes zoom listeners before the old DOM is destroyed.

<details>
<summary>View Fix Diff</summary>

```diff
diff --git a/gc-log-graph/app.js b/gc-log-graph/app.js
index 00bd9ef..9ed6192 100644
--- a/gc-log-graph/app.js
+++ b/gc-log-graph/app.js
@@ -135,8 +135,8 @@ async function handleFileUpload(event) {
 
     statusDiv.textContent = 'Reading file...';
 
-    // Reset UI before starting
-    if (window.resetZoom) window.resetZoom();
+    // Reset UI and state before starting new file
+    currentZoomTransform = null;
     // Note: chartContainer is cleared inside renderChart, no need to do it here
 
     const reader = new FileReader();
@@ -458,6 +458,8 @@ function parseSize(value, unit) {
 }
 
 function renderChart(data) {
+    // Stop any pending transitions and remove zoom listeners from old chart
+    d3.select(chartContainer).selectAll("svg").interrupt().on(".zoom", null);
     chartContainer.innerHTML = '';
 
     if (data.length === 0) {
```

</details>

<details>
<summary>View Verification Logs (Success after Fix)</summary>

```
# First time loading log after app start:
access_log.js:18 [AccessLog] Reset.
access_log.js:141 [AccessLog] render() called. Events to draw: 726
access_log.js:174 [AccessLog] render() scale diagnostics:
access_log.js:175   - x.domain: [1762693203752, 1762693573438]
access_log.js:176   - x.range:  [0, 1469]
access_log.js:177   - Event 0 time: 1762693196500 (2025-11-09T12:59:56.500Z)
access_log.js:178   - Event 0 x(time): -28.816855385381107
access_log.js:182 [AccessLog] Group DOM Position (Initial): 
{x: 180, left: 180, width: 50, height: 50, top: 310.875}
# The Access Log graph shows correctly.
> debugAccess()
access_log.js:196 --- AccessLog GLOBAL DEBUG ---
access_log.js:197 Group DOM Position: DOMRect {x: 49.183143615722656, y: 210.875, width: 927.0771484375, height: 187, top: 210.875, …}
access_log.js:198 Group BBox: SVGRect {x: -30.81685447692871, y: 0, width: 927.0771484375, height: 187}
access_log.js:199 First Bar x1: -28.816855385381107
access_log.js:200 Current Domain: (2) [1762693203752, 1762693573438]
access_log.js:201 Calculated X0 now: -28.816855385381107
# The position is correct, as shown in the debug log.

# Next, load another log file:
access_log.js:18 [AccessLog] Reset.
access_log.js:141 [AccessLog] render() called. Events to draw: 218
access_log.js:174 [AccessLog] render() scale diagnostics:
access_log.js:175   - x.domain: [1762416010182, 1762419454491]
access_log.js:176   - x.range:  [0, 1469]
access_log.js:177   - Event 0 time: 1762416081500 (2025-11-06T08:01:21.500Z)
access_log.js:178   - Event 0 x(time): 30.417172791407506
access_log.js:182 [AccessLog] Group DOM Position (Initial): {x: 180, left: 180, width: 50, height: 50, top: 310.875}
# The Access Log graph does show correctly.
> debugAccess()
access_log.js:196 --- AccessLog GLOBAL DEBUG ---
access_log.js:197 Group DOM Position: DOMRect {x: 108.41717529296875, y: 210.875, width: 1473.827880859375, height: 187, top: 210.875, …}
access_log.js:198 Group BBox: SVGRect {x: 28.417173385620117, y: 0, width: 1473.827880859375, height: 187}
access_log.js:199 First Bar x1: 30.417172791407506
access_log.js:200 Current Domain: (2) [1762416010182, 1762419454491]
access_log.js:201 Calculated X0 now: 30.417172791407506
# The position is corrected, as shown in the debug log.
```

</details>
