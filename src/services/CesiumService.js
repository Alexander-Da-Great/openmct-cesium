import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = null;

        // Initialize the background thread for coordinate math and telemetry parsing
        // Vite automatically detects this URL pattern and handles the bundling
        this.worker = new Worker(new URL('../workers/SpiceWorker.js', import.meta.url), {
            type: 'module'
        });

        this.setupWorkerListeners();
    }

    /**
     * Handles data returning from the background worker
     */
    setupWorkerListeners() {
        this.worker.onmessage = (e) => {
            const { type, id, payload } = e.data;
            if (type === 'DATA_READY') {
                this.applyProcessedData(id, payload);
            }
        };
    }

    /**
     * Initializes the Cesium Viewer with "Cosmographia-style" smoothness settings
     */
    init(container, openmct) {
        if (this.viewer) return;

        this.viewer = new Cesium.Viewer(container, {
            animation: false,
            timeline: false,
            // requestRenderMode: true saves CPU, but requires careful triggers
            requestRenderMode: true, 
            // Setting this to 0.0 forces Cesium to render a frame if the clock moves
            // even by a microsecond. This fills the gaps between 1Hz telemetry.
            maximumRenderTimeChange: 0.0, 
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        // Use SYSTEM_CLOCK for standard 60fps time progression
        this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        this.viewer.clock.shouldAnimate = true;

        if (this.stopBounds) this.stopBounds();
        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer && !openmct.time.isRealTime()) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
                this.viewer.scene.requestRender();
            }
        });

        // WebGL Warmup: Force a resize and render to initialize textures
        this.viewer.resize();
        for (let i = 0; i < 3; i++) {
            this.viewer.render();
        }
    }

    /**
     * Local helper for orientation, used for real-time updates
     */
    getOrientation(datum) {
        if (datum['attitude.qx'] !== undefined) {
            return new Cesium.Quaternion(
                datum['attitude.qx'],
                datum['attitude.qy'],
                datum['attitude.qz'],
                datum['attitude.qw']
            );
        }

        const position = Cesium.Cartesian3.fromDegrees(
            datum['position.longitude'] || 0,
            datum['position.latitude'] || 0,
            datum['position.altitude'] || 400000
        );
        const hpr = new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(datum['attitude.heading'] || 0),
            Cesium.Math.toRadians(datum['attitude.pitch'] || 0),
            Cesium.Math.toRadians(datum['attitude.roll'] || 0)
        );
        return Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
    }

    /**
     * Adds a new satellite and requests its history
     */
    async addSatellite(child, openmct) {
        const id = openmct.objects.makeKeyString(child.identifier);
        if (this.entitiesMap.has(id)) return;

        const positionProperty = new Cesium.SampledPositionProperty();
        const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        
        // High interpolation degree (3) makes even sparse data look curved
        const interpOptions = {
            interpolationDegree: 3,
            interpolationAlgorithm: Cesium.HermitePolynomialApproximation
        };

        positionProperty.setInterpolationOptions(interpOptions);
        orientationProperty.setInterpolationOptions(interpOptions);
        
        // HOLD prevents the spacecraft from disappearing if the clock passes the last data point
        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

        const satellite = this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            orientation: orientationProperty,
            model: {
                uri: child.modelUrl || '/Satellite.glb',
                scale: parseFloat(child.modelScale) || 1.0,
                runAnimations: true
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ 
                    glowPower: 0.1, 
                    color: Cesium.Color.CYAN 
                }),
                width: 4,
                leadTime: 0, 
                trailTime: 1800 
            },
            label: {
                text: child.name,
                font: '12pt monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -30),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000)
            }
        });

        this.entitiesMap.set(id, { positionProperty, orientationProperty, lastUpdateTime: 0 });

        // Offload historical data loading to the Web Worker
        const bounds = openmct.time.getBounds();
        const history = await openmct.telemetry.request(child, bounds);
        if (history && history.length > 0) {
            this.worker.postMessage({ type: 'PROCESS_TELEMETRY', id, data: history });
        }
    }

    /**
     * Direct update from live telemetry stream
     */
    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (props) {
            if (datum.utc <= props.lastUpdateTime) return;
            
            const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
            const pos = Cesium.Cartesian3.fromDegrees(
                datum['position.longitude'], 
                datum['position.latitude'], 
                datum['position.altitude']
            );
            
            props.positionProperty.addSample(time, pos);
            props.orientationProperty.addSample(time, this.getOrientation(datum));
            props.lastUpdateTime = datum.utc;

            // Memory Management: Remove data older than 1 hour
            const pruneTime = Cesium.JulianDate.addSeconds(time, -3600, new Cesium.JulianDate());
            const interval = new Cesium.TimeInterval({
                start: Cesium.JulianDate.fromIso8601("1900-01-01T00:00:00Z"),
                stop: pruneTime,
                isStartIncluded: true,
                isStopIncluded: true
            });
            props.positionProperty.removeSamples(interval);
            props.orientationProperty.removeSamples(interval);
        }
    }

    /**
     * Injects bulk points from the background worker
     */
    applyProcessedData(id, payload) {
        const props = this.entitiesMap.get(id);
        if (!props) return;

        const times = [];
        const positions = [];
        const orientations = [];

        payload.forEach(point => {
            const t = Cesium.JulianDate.fromDate(new Date(point.t));
            times.push(t);
            positions.push(Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.alt));
            if (point.q) {
                orientations.push(new Cesium.Quaternion(point.q[0], point.q[1], point.q[2], point.q[3]));
            }
        });

        // Batch adding is significantly more performant
        props.positionProperty.addSamples(times, positions);
        if (orientations.length > 0) {
            props.orientationProperty.addSamples(times, orientations);
        }
        
        this.viewer.scene.requestRender();
    }

    trackEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) this.viewer.trackedEntity = entity;
    }

    flyToEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) {
            this.viewer.flyTo(entity, {
                offset: new Cesium.HeadingPitchRange(0, -0.5, 5000)
            });
        }
    }

    resetView() {
        if (this.viewer) {
            this.viewer.trackedEntity = undefined;
            this.viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(0.0, 0.0, 20000000.0)
            });
        }
    }

    removeSatellite(id) {
        this.viewer?.entities.removeById(id);
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopBounds === 'function') {
            this.stopBounds();
            this.stopBounds = null;
        }
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        if (this.worker) {
            this.worker.terminate();
        }
        this.entitiesMap.clear();
    }
}

export default CesiumService;