/**
 * SpiceWorker.js
 * Offloads telemetry parsing and coordinate math from the main UI thread.
 */

self.onmessage = function(e) {
    const { type, id, data } = e.data;

    if (type === 'PROCESS_TELEMETRY') {
        // Handle bulk historical data or SPICE prediction windows
        const processed = data.map(point => {
            // We normalize the keys here so the CesiumService doesn't have to
            // look for specific Open MCT telemetry strings
            return {
                t: point.utc,
                lat: point['position.latitude'],
                lon: point['position.longitude'],
                alt: point['position.altitude'],
                // Include orientation if available (Quaternion order [x, y, z, w])
                q: point['attitude.qx'] !== undefined ? [
                    point['attitude.qx'],
                    point['attitude.qy'],
                    point['attitude.qz'],
                    point['attitude.qw']
                ] : null
            };
        });

        // Send the clean, flat array back to the main thread
        self.postMessage({ 
            type: 'DATA_READY', 
            id: id, 
            payload: processed 
        });
    }

    if (type === 'QUERY_SPICE') {
        /**
         * Future Implementation:
         * This is where you would handle the predicted time windows.
         * 1. Worker fetches data from your SpiceyPy FastAPI backend.
         * 2. Worker interpolates the BSP/CK states.
         * 3. Worker returns the "Planned" path to be rendered as a ghost entity.
         */
    }
};