1. The "Memory Leak" of Sampled Properties

In updateSatellite, you are calling addSample every time a telemetry packet arrives.

    The Problem: SampledPositionProperty keeps every sample indefinitely. If your mission runs for 4 hours with 1Hz data, you're storing thousands of points in memory per satellite. Eventually, the interpolation calculation will slow down.

    The Fix: Use positionProperty.removeSamples(startTime, endTime) to prune old data, or set a maxSampleCount.

2. The CallbackProperty Performance Tax

Your Sensor Cone uses a CallbackProperty to calculate its offset position every single frame.

    The Problem: new Cesium.CallbackProperty executes on the Main Thread. If you have 10 satellites with sensors, you are doing matrix math and quaternion-to-matrix conversions 60 times a second on the UI thread.

    The Fix: Instead of a CallbackProperty, use a ReferenceProperty or attach the cone as a model node if your GLB has a defined "sensor" joint. Alternatively, perform the offset math inside your updateSatellite logic and feed a second SampledPositionProperty to the cone.

3. Coordinate System Precision

You are using Cartesian3.fromDegrees.

    The Peer Review: For low Earth orbit (LEO), this is fine. However, Cosmographia uses Inertial Frames (ICRF/ECI). If your satellite is following a physical orbit, using Lat/Lon/Alt (Fixed frame) is tricky because the Earth is rotating underneath the satellite.

    The Fix: If your DB provides ECI coordinates, keep them in ECI and let Cesium handle the transformation to the Fixed frame. This prevents "wobble" during high-speed time acceleration.

4. Logic Improvements

    RequestRenderMode: You have requestRenderMode: false. This means Cesium is rendering as fast as it can (usually 60fps). To save user CPU/Battery (vital for web apps), set this to true and call viewer.scene.requestRender() only when updateSatellite receives data or the camera moves.

    Z-Fighting: Your disableDepthTestDistance: Number.POSITIVE_INFINITY on the label is a pro move—it ensures the name is always visible. Nice touch.