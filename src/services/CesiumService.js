import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = null;
        this.worker = new Worker(new URL('../workers/SpiceWorker.js', import.meta.url), {
            type: 'module'
        });
        this.setupWorkerListeners();
    }

    setupWorkerListeners() {
        this.worker.onmessage = (e) => {
            const { type, id, payload } = e.data;
            if (type === 'DATA_READY') {
                this.applyProcessedData(id, payload);
            }
        };
    }

    init(container, openmct) {
        if (this.viewer) return;

        this.viewer = new Cesium.Viewer(container, {
            animation: false,
            timeline: false,
            requestRenderMode: false, // Must be false for constant smooth gliding
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        this.viewer.clock.shouldAnimate = true;

        if (this.stopBounds) this.stopBounds();
        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer && !openmct.time.isRealTime()) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
            }
        });

        this.viewer.resize();
    }

    getOrientation(datum) {
        if (datum['attitude.qx'] !== undefined) {
            return new Cesium.Quaternion(
                datum['attitude.qx'], datum['attitude.qy'], 
                datum['attitude.qz'], datum['attitude.qw']
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

    async addSatellite(child, openmct) {
        const id = openmct.objects.makeKeyString(child.identifier);
        if (this.entitiesMap.has(id)) return;

        const positionProperty = new Cesium.SampledPositionProperty();
        const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        
        // Degree 2 Hermite creates the smooth orbital arc
        const interpOptions = {
            interpolationDegree: 2,
            interpolationAlgorithm: Cesium.HermitePolynomialApproximation
        };

        positionProperty.setInterpolationOptions(interpOptions);
        orientationProperty.setInterpolationOptions(interpOptions);
        
        // HOLD ensures visibility if stream drops
        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        orientationProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

        const satellite = this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            orientation: orientationProperty,
            model: {
                uri: child.modelUrl || '/Satellite.glb',
                scale: parseFloat(child.modelScale) || 1.0
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN }),
                width: 4,
                leadTime: 0, 
                trailTime: 600 
            }
        });

        this.entitiesMap.set(id, { positionProperty, orientationProperty, lastSampleTime: null });

        const bounds = openmct.time.getBounds();
        const history = await openmct.telemetry.request(child, bounds);
        if (history && history.length > 0) {
            this.worker.postMessage({ type: 'PROCESS_TELEMETRY', id, data: history });
        }
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (!props) return;

        const time = Cesium.JulianDate.fromDate(new Date(datum.utc));

        if (props.lastSampleTime && Cesium.JulianDate.compare(time, props.lastSampleTime) <= 0) {
            return; 
        }

        const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
        const ori = this.getOrientation(datum);
        
        props.positionProperty.addSample(time, pos);
        props.orientationProperty.addSample(time, ori);
        props.lastSampleTime = time;

        // --- THE "BUTTER" FIX: CLOCK OFFSET ---
        // We set the viewer clock to be 2 seconds BEHIND the latest telemetry packet.
        // This ensures Cesium always has a "next point" to interpolate toward.
        const delayedTime = Cesium.JulianDate.addSeconds(time, -2.0, new Cesium.JulianDate());
        
        if (this.viewer && !this.viewer.trackedEntity) {
             this.viewer.clock.currentTime = delayedTime;
        }

        // Memory cleanup
        const pruneTime = Cesium.JulianDate.addSeconds(time, -600, new Cesium.JulianDate());
        const interval = new Cesium.TimeInterval({
            start: Cesium.JulianDate.fromIso8601("1900-01-01T00:00:00Z"),
            stop: pruneTime
        });
        props.positionProperty.removeSamples(interval);
    }

    applyProcessedData(id, payload) {
        const props = this.entitiesMap.get(id);
        if (!props) return;

        payload.forEach(point => {
            const time = Cesium.JulianDate.fromDate(new Date(point.t));
            if (!props.lastSampleTime || Cesium.JulianDate.compare(time, props.lastSampleTime) > 0) {
                const pos = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.alt);
                props.positionProperty.addSample(time, pos);
                if (point.q) {
                    props.orientationProperty.addSample(time, new Cesium.Quaternion(point.q[0], point.q[1], point.q[2], point.q[3]));
                }
                props.lastSampleTime = time;
            }
        });
    }

    trackEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) this.viewer.trackedEntity = entity;
    }

    flyToEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) this.viewer.flyTo(entity);
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