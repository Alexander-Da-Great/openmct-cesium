import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
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

        if (!this.viewer) return;

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

        const composition = openmct.composition.get(child);
        composition.on('add', (sensorObj) => this.addSensor(id, sensorObj));
        composition.on('remove', (sensorIdentifier) => this.removeSensor(id, sensorIdentifier));
        composition.load();

        const history = await openmct.telemetry.request(child, openmct.time.getBounds());
        if (history?.length) {
            this.worker.postMessage({ type: 'PROCESS_TELEMETRY', id, data: history });
        }
    }

    addSensor(satelliteId, sensorObj) {
        if (!this.viewer) return;

        const satProps = this.entitiesMap.get(satelliteId);
        const sensorId = satelliteId + '-' + sensorObj.identifier.key;
        const footprintId = sensorId + '-footprint';

        this.viewer.entities.removeById(sensorId);
        this.viewer.entities.removeById(footprintId);

        const range = sensorObj.range || 800000;
        const fov = sensorObj.fov || 30;
        const color = Cesium.Color.fromCssColorString(sensorObj.color || '#ffff00');

        // 1. Define Local Vector and Rotation Correction
        let localDir;
        let axisCorrection = Cesium.Quaternion.IDENTITY;

        switch (sensorObj.direction) {
            case '+X': 
                localDir = Cesium.Cartesian3.UNIT_X; 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(90));
                break;
            case '-X': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(-90));
                break;
            case '+Y': 
                localDir = Cesium.Cartesian3.UNIT_Y; 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.toRadians(-90));
                break;
            case '-Y': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.toRadians(90));
                break;
            case '-Z': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Math.PI);
                break;
            case '+Z':
            default:   
                localDir = Cesium.Cartesian3.UNIT_Z; 
                axisCorrection = Cesium.Quaternion.IDENTITY;
                break;
        }

        

        // 2. Add the Sensor Volume
        this.viewer.entities.add({
            id: sensorId,
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return pos;

                // Create transformation matrix from satellite attitude
                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                // Rotate our local pointing direction into World Space
                const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localDir, new Cesium.Cartesian3());
                
                // CRITICAL FIX: The center of the cylinder must be shifted by HALF the length
                // so that the 'top' (the pointy end) stays at the satellite's position.
                const offset = Cesium.Cartesian3.multiplyByScalar(worldDir, range / 2, new Cesium.Cartesian3());
                return Cesium.Cartesian3.add(pos, offset, new Cesium.Cartesian3());
            }, false),
            orientation: new Cesium.CallbackProperty((time) => {
                const satOri = satProps.orientationProperty.getValue(time);
                if (!satOri) return undefined;
                // Align cylinder axis with the satellite's chosen direction axis
                return Cesium.Quaternion.multiply(satOri, axisCorrection, new Cesium.Quaternion());
            }, false),
            cylinder: {
                length: range,
                topRadius: 0.0, // Pointy end
                bottomRadius: Math.tan(Cesium.Math.toRadians(fov / 2)) * range,
                slices: sensorObj.shape === 'frustum' ? 4 : 64,
                material: color.withAlpha(0.3),
                outline: true,
                outlineColor: color.withAlpha(0.6)
            }
        });

        // 3. Add the Footprint
        this.viewer.entities.add({
            id: footprintId,
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return undefined;

                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localDir, new Cesium.Cartesian3());
                const ray = new Cesium.Ray(pos, worldDir);
                return this.viewer.scene.globe.pick(ray, this.viewer.scene);
            }, false),
            ellipse: {
                semiMajorAxis: new Cesium.CallbackProperty((time) => {
                    const pos = satProps.positionProperty.getValue(time);
                    if (!pos) return 0;
                    const alt = Cesium.Cartographic.fromCartesian(pos).height;
                    return Math.tan(Cesium.Math.toRadians(fov / 2)) * alt;
                }, false),
                semiMinorAxis: new Cesium.CallbackProperty((time) => {
                    const pos = satProps.positionProperty.getValue(time);
                    if (!pos) return 0;
                    const alt = Cesium.Cartographic.fromCartesian(pos).height;
                    const aspect = (sensorObj.shape === 'frustum') ? (sensorObj.aspectRatio || 1.0) : 1.0;
                    return Math.tan(Cesium.Math.toRadians(fov / 2)) * alt * aspect;
                }, false),
                material: color.withAlpha(0.4),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                outline: true,
                outlineColor: color
            }
        });
    }

    removeSensor(satelliteId, sensorIdentifier) {
        if (this.viewer) {
            const id = satelliteId + '-' + sensorIdentifier.key;
            this.viewer.entities.removeById(id);
            this.viewer.entities.removeById(id + '-footprint');
        }
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (!props || datum.utc <= props.lastUpdateTime) return;

        const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
        const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
        
        props.positionProperty.addSample(time, pos);
        props.orientationProperty.addSample(time, this.getOrientation(datum));
        props.lastUpdateTime = datum.utc;

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
            if (p.q) props.orientationProperty.addSample(t, new Cesium.Quaternion(...p.q));
        });
    }

    removeSatellite(id) {
        if (this.viewer) {
            this.viewer.entities.removeById(id);
            const sensors = this.viewer.entities.values.filter(e => e.id.startsWith(id + '-'));
            sensors.forEach(s => this.viewer.entities.remove(s));
        }
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopBounds === 'function') this.stopBounds();
        if (this.viewer) { this.viewer.destroy(); this.viewer = null; }
        this.worker.terminate();
        this.entitiesMap.clear();
    }
}

export default CesiumService;