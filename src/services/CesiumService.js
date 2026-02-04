import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = () => {};
        this._sensorUnsubscribe = null;
        
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
            // PERFORMANCE BOOST: Disable constant rendering
            requestRenderMode: true, 
            // Ensure we still get at least one frame occasionally for clock updates
            maximumRenderTimeChange: 0.0, 
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        this.viewer.clock.shouldAnimate = true;
        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer && !openmct.time.isRealTime()) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
            }
        });
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
        const interp = { interpolationDegree: 2, interpolationAlgorithm: Cesium.HermitePolynomialApproximation };
        
        positionProperty.setInterpolationOptions(interp);
        orientationProperty.setInterpolationOptions(interp);

        this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            orientation: orientationProperty,
            show: child.showSatellite !== false,
            model: { uri: child.modelUrl || '/Satellite.glb', scale: parseFloat(child.modelScale) || 1.0 },
            path: {
                show: child.showOrbit !== false,
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

    updateSatelliteProperties(id, satelliteObj) {
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            // Use == true to catch both boolean true and string "true"
            entity.show = satelliteObj.showSatellite == true;
            
            if (entity.path) {
                entity.path.show = satelliteObj.showOrbit == true;
            }
        }
    }

    addSensor(satelliteId, sensorObj) {
        if (!this.viewer) return;
        const satProps = this.entitiesMap.get(satelliteId);
        const satelliteEntity = this.viewer.entities.getById(satelliteId);
        if (!satProps) return;

        const sensorId = satelliteId + '-' + sensorObj.identifier.key;
        const footprintId = sensorId + '-footprint';

        this.viewer.entities.removeById(sensorId);
        this.viewer.entities.removeById(footprintId);

        // Visibility Check
        if (sensorObj.showPOV == false || sensorObj.showPOV === "false") return;

        const range = parseFloat(sensorObj.range) || 800000;
        const fov = parseFloat(sensorObj.fov) || 30;
        const color = Cesium.Color.fromCssColorString(sensorObj.color || '#ffff00');

        let localDir;
        let axisCorrection = Cesium.Quaternion.IDENTITY;

        switch (sensorObj.direction) {
            case '+X': 
                localDir = Cesium.Cartesian3.UNIT_X; 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(90)); break;
            case '-X': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(-90)); break;
            case '+Y': 
                localDir = Cesium.Cartesian3.UNIT_Y; 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.toRadians(-90)); break;
            case '-Y': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.toRadians(90)); break;
            case '-Z': 
                localDir = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()); 
                axisCorrection = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Math.PI); break;
            default: localDir = Cesium.Cartesian3.UNIT_Z; axisCorrection = Cesium.Quaternion.IDENTITY;
        }

        this.viewer.entities.add({
            id: sensorId,
            parent: satelliteEntity, // Using parent helps with visibility hierarchy
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return pos;
                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localDir, new Cesium.Cartesian3());
                const offset = Cesium.Cartesian3.multiplyByScalar(worldDir, range / 2, new Cesium.Cartesian3());
                return Cesium.Cartesian3.add(pos, offset, new Cesium.Cartesian3());
            }, false),
            orientation: new Cesium.CallbackProperty((time) => {
                const satOri = satProps.orientationProperty.getValue(time);
                if (!satOri) return undefined;
                return Cesium.Quaternion.multiply(satOri, axisCorrection, new Cesium.Quaternion());
            }, false),
            cylinder: {
                length: range, topRadius: Math.tan(Cesium.Math.toRadians(fov / 2)) * range,
                bottomRadius: 0.0,
                slices: sensorObj.shape === 'frustum' ? 4 : 64,
                material: color.withAlpha(0.3), outline: true, outlineColor: color.withAlpha(0.6)
            }
        });

        this.viewer.entities.add({
            id: footprintId,
            parent: satelliteEntity,
            position: new Cesium.CallbackProperty((time) => {
                const pos = satProps.positionProperty.getValue(time);
                const ori = satProps.orientationProperty.getValue(time);
                if (!pos || !ori) return undefined;
                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localDir, new Cesium.Cartesian3());
                return this.viewer.scene.globe.pick(new Cesium.Ray(pos, worldDir), this.viewer.scene);
            }, false),
            ellipse: {
                semiMajorAxis: new Cesium.CallbackProperty((time) => {
                    const pos = satProps.positionProperty.getValue(time);
                    return pos ? Math.tan(Cesium.Math.toRadians(fov / 2)) * Cesium.Cartographic.fromCartesian(pos).height : 0;
                }, false),
                semiMinorAxis: new Cesium.CallbackProperty((time) => {
                    const pos = satProps.positionProperty.getValue(time);
                    const aspect = (sensorObj.shape === 'frustum') ? (parseFloat(sensorObj.aspectRatio) || 1.0) : 1.0;
                    return pos ? Math.tan(Cesium.Math.toRadians(fov / 2)) * Cesium.Cartographic.fromCartesian(pos).height * aspect : 0;
                }, false),
                material: color.withAlpha(0.4), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                outline: true, outlineColor: color
            }
        });
    }

    setSensorView(satelliteId, sensorObj) {
        if (!this.viewer) return;
        const satProps = this.entitiesMap.get(satelliteId);
        if (!satProps) return;

        this.stopSensorView();
        this.viewer.trackedEntity = undefined;

        let localBoresight;
        switch (sensorObj.direction) {
            case '+X': localBoresight = Cesium.Cartesian3.UNIT_X; break;
            case '-X': localBoresight = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_X, new Cesium.Cartesian3()); break;
            case '+Y': localBoresight = Cesium.Cartesian3.UNIT_Y; break;
            case '-Y': localBoresight = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3()); break;
            case '-Z': localBoresight = Cesium.Cartesian3.negate(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()); break;
            default:   localBoresight = Cesium.Cartesian3.UNIT_Z;
        }

        this._sensorUnsubscribe = this.viewer.scene.postRender.addEventListener(() => {
            const time = this.viewer.clock.currentTime;
            const pos = satProps.positionProperty.getValue(time);
            const ori = satProps.orientationProperty.getValue(time);
            if (!pos || !ori) return;

            const matrix = Cesium.Matrix3.fromQuaternion(ori);
            const worldDir = Cesium.Matrix3.multiplyByVector(matrix, localBoresight, new Cesium.Cartesian3());
            const worldUp = Cesium.Matrix3.multiplyByVector(matrix, Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3());

            this.viewer.camera.setView({
                destination: pos,
                orientation: { direction: worldDir, up: worldUp }
            });
        });
    }

    stopSensorView() {
        if (this._sensorUnsubscribe) {
            this._sensorUnsubscribe();
            this._sensorUnsubscribe = null;
        }
    }

    trackEntity(id) {
        if (!this.viewer) return;
        this.stopSensorView();
        const entity = this.viewer.entities.getById(id);
        if (entity) this.viewer.trackedEntity = entity;
    }

    flyToEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) this.viewer.flyTo(entity);
    }

    removeSensor(satelliteId, sensorIdentifier) {
        const id = satelliteId + '-' + (sensorIdentifier.key || sensorIdentifier);
        this.viewer.entities.removeById(id);
        this.viewer.entities.removeById(id + '-footprint');
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        const entity = this.viewer.entities.getById(id);
        
        // IF NOT VISIBLE: We still add the sample to the property 
        // so the trail is correct, but we skip the clock/HPR logic.
        if (!props || datum.utc <= props.lastUpdateTime) return;

        const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
        const pos = Cesium.Cartesian3.fromDegrees(
            datum['position.longitude'], 
            datum['position.latitude'], 
            datum['position.altitude']
        );
        
        // Essential: Add sample so the trail history grows
        props.positionProperty.addSample(time, pos);
        
        // OPTIMIZATION: Skip rotation math if the model is hidden
        if (entity && entity.show !== false) {
            props.orientationProperty.addSample(time, this.getOrientation(datum));
        }
        
        props.lastUpdateTime = datum.utc;
        if (this.viewer) {
            this.viewer.scene.requestRender();
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
        if (this.viewer) {
            this.viewer.scene.requestRender();
        }
    }

    removeSatellite(id) {
        if (this.viewer) {
            this.viewer.entities.removeById(id);
            const sensors = this.viewer.entities.values.filter(e => e.id && e.id.startsWith(id + '-'));
            sensors.forEach(s => this.viewer.entities.remove(s));
        }
        this.entitiesMap.delete(id);
    }

    destroy() {
        this.stopSensorView();
        if (typeof this.stopBounds === 'function') this.stopBounds();
        if (this.viewer) { this.viewer.destroy(); this.viewer = null; }
        this.worker.terminate();
        this.entitiesMap.clear();
    }
}

export default CesiumService;