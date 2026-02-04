import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        // Initialize as a no-op function to prevent "not a function" errors 
        // if destroy is called before init
        this.stopBounds = () => {}; 
        
        this.worker = new Worker(new URL('../workers/SpiceWorker.js', import.meta.url), { 
            type: 'module' 
        });
        
        this.setupWorkerListeners();
    }

    setupWorkerListeners() {
        this.worker.onmessage = (e) => {
            const { id, payload } = e.data;
            this.applyProcessedData(id, payload);
        };
    }

    init(container, openmct) {
        if (this.viewer) return;

        this.viewer = new Cesium.Viewer(container, {
            animation: false,
            timeline: false,
            requestRenderMode: false, 
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        this.viewer.clock.shouldAnimate = true;

        // Store the unsubscribe function returned by MCT
        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer && !openmct.time.isRealTime()) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
            }
        });

        this.viewer.resize();
    }

    getOrientation(datum) {
        const position = Cesium.Cartesian3.fromDegrees(
            datum['position.longitude'], 
            datum['position.latitude'], 
            datum['position.altitude']
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
        
        const interp = { 
            interpolationDegree: 2, 
            interpolationAlgorithm: Cesium.HermitePolynomialApproximation 
        };
        positionProperty.setInterpolationOptions(interp);
        orientationProperty.setInterpolationOptions(interp);

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
                trailTime: 1800, 
                leadTime: 0
            }
        });

        this.entitiesMap.set(id, { positionProperty, orientationProperty, lastUpdateTime: 0 });

        // Composition listener for dynamic sensors
        const composition = openmct.composition.get(child);
        composition.on('add', (sensorObj) => {
            if (sensorObj.type === 'satellite.sensor') {
                this.addSensor(id, sensorObj);
            }
        });
        composition.on('remove', (sensorIdentifier) => {
            const sensorId = id + '-' + sensorIdentifier.key;
            if (this.viewer) {
                this.viewer.entities.removeById(sensorId);
            }
        });
        composition.load();

        const history = await openmct.telemetry.request(child, openmct.time.getBounds());
        if (history?.length) {
            this.worker.postMessage({ type: 'PROCESS_TELEMETRY', id, data: history });
        }
    }

    addSensor(satelliteId, sensorObj) {
        const satProps = this.entitiesMap.get(satelliteId);
        const satelliteEntity = this.viewer.entities.getById(satelliteId);
        const sensorId = satelliteId + '-' + sensorObj.identifier.key;

        const range = sensorObj.sensorRange || 800000;
        const fovRad = Cesium.Math.toRadians(sensorObj.sensorFov || 30);
        const bottomRadius = Math.tan(fovRad / 2) * range;
        const color = Cesium.Color.fromCssColorString(sensorObj.sensorColor || '#ffff00').withAlpha(0.3);

        this.viewer.entities.add({
            id: sensorId,
            parent: satelliteEntity,
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return pos;

                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                const direction = Cesium.Matrix3.getColumn(matrix, 2, new Cesium.Cartesian3());
                const offset = Cesium.Cartesian3.multiplyByScalar(direction, range / 2, new Cesium.Cartesian3());
                return Cesium.Cartesian3.add(pos, offset, new Cesium.Cartesian3());
            }, false),
            orientation: satProps.orientationProperty,
            cylinder: {
                length: range,
                topRadius: 0.0, // Sharp tip at spacecraft
                bottomRadius: bottomRadius,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.6)
            }
        });
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (!props || datum.utc <= props.lastUpdateTime) return;

        const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
        const pos = Cesium.Cartesian3.fromDegrees(
            datum['position.longitude'], 
            datum['position.latitude'], 
            datum['position.altitude']
        );
        
        props.positionProperty.addSample(time, pos);
        props.orientationProperty.addSample(time, this.getOrientation(datum));
        props.lastUpdateTime = datum.utc;

        // "Butter" lag for smoothness
        const delayedTime = Cesium.JulianDate.addSeconds(time, -1.0, new Cesium.JulianDate());
        if (this.viewer && !this.viewer.trackedEntity) {
            this.viewer.clock.currentTime = delayedTime;
        }
    }

    applyProcessedData(id, payload) {
        const props = this.entitiesMap.get(id);
        if (!props) return;

        payload.forEach(p => {
            const t = Cesium.JulianDate.fromDate(new Date(p.t));
            props.positionProperty.addSample(t, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
            if (p.q) {
                props.orientationProperty.addSample(t, new Cesium.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]));
            }
        });
    }

    trackEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) this.viewer.trackedEntity = entity;
    }

    flyToEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) this.viewer.flyTo(entity);
    }

    removeSatellite(id) {
        if (this.viewer) {
            this.viewer.entities.removeById(id);
            const sensors = this.viewer.entities.values.filter(e => e.parent && e.parent.id === id);
            sensors.forEach(s => this.viewer.entities.remove(s));
        }
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopBounds === 'function') {
            this.stopBounds();
            this.stopBounds = () => {};
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