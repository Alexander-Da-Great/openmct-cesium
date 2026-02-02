import * as Cesium from 'cesium';

class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = () => {};
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
        const bounds = openmct.time.getBounds();
        const history = await openmct.telemetry.request(child, bounds);
        
        const positionProperty = new Cesium.SampledPositionProperty();
        const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        
        positionProperty.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LinearApproximation
        });

        orientationProperty.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LinearApproximation
        });

        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
        orientationProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;

        if (history && history.length > 0) {
            history.forEach(p => {
                const time = Cesium.JulianDate.fromDate(new Date(p.utc));
                const pos = Cesium.Cartesian3.fromDegrees(p['position.longitude'], p['position.latitude'], p['position.altitude']);
                positionProperty.addSample(time, pos);
                orientationProperty.addSample(time, this.getOrientation(p));
            });
        }

        // --- 1. Main Spacecraft Entity ---
        const satellite = this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            orientation: orientationProperty,
            model: {
                uri: child.modelUrl || '/Satellite.glb',
                scale: parseFloat(child.modelScale) || 1.0,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 5000000.0)
            },
            point: {
                pixelSize: 10,
                color: Cesium.Color.CYAN,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(5000000.0, Number.MAX_VALUE)
            },
            label: {
                text: child.name,
                font: '12pt monospace',
                pixelOffset: new Cesium.Cartesian2(0, -25),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY 
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN }),
                width: 3,
                leadTime: 0, 
                trailTime: 3600  
            }
        });

        // --- 2. Sensor Cone Child Entity ---
        const range = child.sensorRange || 1000000;
        const fovRad = Cesium.Math.toRadians(child.sensorFov || 30);
        const bottomRadius = Math.tan(fovRad / 2) * range;

        this.viewer.entities.add({
            parent: satellite,
            // Offset logic: Move the cone center "forward" so the tip is at the satellite origin
            position: new Cesium.CallbackProperty((time) => {
                const pos = positionProperty.getValue(time);
                const ori = orientationProperty.getValue(time);
                if (!pos || !ori) return pos;

                // Create a transformation matrix from orientation
                const matrix = Cesium.Matrix3.fromQuaternion(ori);
                // Get the 'Forward' vector (usually Z in GLB space)
                const direction = Cesium.Matrix3.getColumn(matrix, 2, new Cesium.Cartesian3());
                // Center of cylinder is half-range away from the satellite
                const offset = Cesium.Cartesian3.multiplyByScalar(direction, range / 2, new Cesium.Cartesian3());
                
                return Cesium.Cartesian3.add(pos, offset, new Cesium.Cartesian3());
            }, false),
            orientation: orientationProperty,
            cylinder: {
                length: range,
                topRadius: bottomRadius,
                bottomRadius: 0.0,
                material: Cesium.Color.CYAN.withAlpha(0.3),
                outline: true,
                outlineColor: Cesium.Color.CYAN.withAlpha(0.5)
            }
        });

        this.entitiesMap.set(id, { positionProperty, orientationProperty });
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (props) {
            const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
            const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
            props.positionProperty.addSample(time, pos);
            props.orientationProperty.addSample(time, this.getOrientation(datum));
        }
    }

    resetView() {
        if (!this.viewer) return;
        this.viewer.trackedEntity = undefined;
        this.viewer.camera.cancelFlight();
        this.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(0.0, 0.0, 20000000.0),
            duration: 2.0
        });
    }

    trackEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            this.viewer.camera.cancelFlight();
            this.viewer.trackedEntity = entity;
        }
    }

    flyToEntity(id) {
        if (!this.viewer) return;
        this.viewer.trackedEntity = undefined; 
        this.viewer.camera.cancelFlight();
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            this.viewer.flyTo(entity, {
                offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 1500000),
                duration: 2.0
            });
        }
    }

    removeSatellite(id) {
        if (this.viewer) this.viewer.entities.removeById(id);
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopBounds === 'function') this.stopBounds();
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        this.entitiesMap.clear();
    }
}

export default new CesiumService();