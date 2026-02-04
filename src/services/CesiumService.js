import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = () => {};
        
        // Background thread for coordinate math and telemetry parsing
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

        // Composition listener for dynamic sensors
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
        const satelliteEntity = this.viewer.entities.getById(satelliteId);
        const sensorId = satelliteId + '-' + sensorObj.identifier.key;

        this.viewer.entities.removeById(sensorId);

        const range = sensorObj.range || 800000;
        const fov = sensorObj.fov || 30;
        const color = Cesium.Color.fromCssColorString(sensorObj.color || '#ffff00').withAlpha(0.3);

        // 1. Determine the pointing vector in satellite local space
        // We start with a unit vector based on the chosen axis
        let localDir;
        switch (sensorObj.direction) {
            case '+X': localDir = Cesium.Cartesian3.UNIT_X; break;
            case '-X': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()); break;
            case '+Y': localDir = Cesium.Cartesian3.UNIT_Y; break;
            case '-Y': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()); break;
            case '-Z': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()); break;
            default:   localDir = Cesium.Cartesian3.UNIT_Z; // +Z is default Forward
        }

        this.viewer.entities.add({
            id: sensorId,
            parent: satelliteEntity,
            // ORIENTATION: Combine satellite attitude + local sensor rotation
            orientation: new Cesium.CallbackProperty((time) => {
                const satOri = satProps.orientationProperty.getValue(time);
                if (!satOri) return undefined;

                // Cylinder default is pointing Up (+Z). 
                // We need to rotate it to match our 'localDir'
                let axisCorrection = Cesium.Quaternion.IDENTITY;
                
                if (sensorObj.direction === '-Z') {
                    // Rotate 180 degrees to point backward
                    axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Math.PI);
                } else if (sensorObj.direction.includes('X')) {
                    axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(90));
                } else if (sensorObj.direction.includes('Y')) {
                    axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.toRadians(90));
                }

                // Combine satellite's current attitude with our axis adjustment
                return Cesium.Quaternion.multiply(satOri, axisCorrection, new Cesium.Quaternion());
            }, false),

            // POSITION: Always offset by range/2 along the calculated direction
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return pos;

                const range = sensorObj.range || 800000;
                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                
                // 1. Define the unit vector for the pointing direction in local space
                let localDir;
                switch (sensorObj.direction) {
                    case '+X': localDir = Cesium.Cartesian3.UNIT_X; break;
                    case '-X': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()); break;
                    case '+Y': localDir = Cesium.Cartesian3.UNIT_Y; break;
                    case '-Y': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()); break;
                    case '+Z': localDir = Cesium.Cartesian3.UNIT_Z; break;
                    case '-Z': localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()); break;
                    default:   localDir = Cesium.Cartesian3.UNIT_Z;
                }

                // 2. Transform the local direction vector into world space using satellite orientation
                const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localDir, new Cesium.Cartesian3());
                
                // 3. Move the center of the cone AWAY from the satellite by half its length
                // This ensures the tip (apex) stays exactly at the satellite position
                const halfLengthOffset = Cesium.Cartesian3.multiplyByScalar(worldDir, range / 2, new Cesium.Cartesian3());
                
                return Cesium.Cartesian3.add(pos, halfLengthOffset, new Cesium.Cartesian3());
            }, false),

            cylinder: {
                length: range,
                topRadius: 0.0,
                bottomRadius: Math.tan(Cesium.Math.toRadians(fov / 2)) * range,
                material: color,
                outline: true,
                outlineColor: color.withAlpha(0.6)
            }
        });
    }

    removeSensor(satelliteId, sensorIdentifier) {
        if (this.viewer) {
            this.viewer.entities.removeById(satelliteId + '-' + sensorIdentifier.key);
        }
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

        // "Butter" lag: interpolation destination buffer
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
            // Find and remove all child sensor entities
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