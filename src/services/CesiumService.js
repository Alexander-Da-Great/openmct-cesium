import * as Cesium from 'cesium';

/**
 * CesiumService manages a single, non-reactive Cesium Viewer instance.
 * This service handles the initialization and lifecycle of the Cesium globe viewer,
 * similar to how Open MCT's imagery plugin manages high-frequency rendering loops.
 */
class CesiumService {
  constructor() {
    this.viewer = null;
    this.container = null;
    this.satelliteEntities = new Map(); // Track satellite entities by ID
    this.trajectoryEntities = new Map(); // Track trajectory polylines by ID
  }

  /**
   * Initialize the Cesium Viewer instance
   * @param {HTMLElement} container - The DOM element to render the viewer into
   * @param {Object} options - Optional Cesium Viewer configuration options
   * @returns {Cesium.Viewer} The initialized viewer instance
   */
  initializeViewer(container, options = {}) {
    if (this.viewer) {
      console.warn('CesiumService: Viewer already initialized');
      return this.viewer;
    }

    this.container = container;

    // Default Cesium viewer configuration
    const defaultOptions = {
      animation: true, // Enable animation widget for playback control
      timeline: true, // Enable timeline widget for scrubbing
      baseLayerPicker: true,
      geocoder: true,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: true,
      infoBox: true,
      requestRenderMode: false, // Disable for smooth animation playback
      ...options
    };

    try {
      this.viewer = new Cesium.Viewer(container, defaultOptions);

      // Configure scene for better performance
      this.configureScene();

      console.log('CesiumService: Viewer initialized successfully');
      return this.viewer;
    } catch (error) {
      console.error('CesiumService: Failed to initialize viewer', error);
      throw error;
    }
  }

  /**
   * Configure scene settings for optimal performance
   * Following Open MCT's approach to high-frequency rendering optimization
   */
  configureScene() {
    if (!this.viewer) {
      return;
    }

    const { scene } = this.viewer;

    // Enable FXAA for better visual quality
    scene.postProcessStages.fxaa.enabled = true;

    // Configure lighting
    scene.globe.enableLighting = true;

    // Set initial camera position (view of Earth from space)
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0.0, 0.0, 20000000.0)
    });
  }

  /**
   * Get the current viewer instance
   * @returns {Cesium.Viewer|null}
   */
  getViewer() {
    return this.viewer;
  }

  /**
   * Request a render frame - useful when using requestRenderMode
   */
  requestRender() {
    if (this.viewer && this.viewer.scene) {
      this.viewer.scene.requestRender();
    }
  }

  /**
   * Fly to a specific location
   * @param {Object} options - Cesium camera fly-to options
   */
  flyTo(options) {
    if (this.viewer) {
      this.viewer.camera.flyTo(options);
    }
  }

  /**
   * Add an entity to the viewer
   * @param {Object} entityOptions - Cesium entity configuration
   * @returns {Cesium.Entity|null}
   */
  addEntity(entityOptions) {
    if (this.viewer) {
      return this.viewer.entities.add(entityOptions);
    }
    return null;
  }

  /**
   * Remove an entity from the viewer
   * @param {Cesium.Entity} entity - The entity to remove
   */
  removeEntity(entity) {
    if (this.viewer && entity) {
      this.viewer.entities.remove(entity);
    }
  }

  /**
   * Set or update a satellite's position on the globe
   * @param {string} id - Unique identifier for the satellite
   * @param {Object} position - Position object with lat, lon, alt
   * @param {number} position.lat - Latitude in degrees
   * @param {number} position.lon - Longitude in degrees
   * @param {number} position.alt - Altitude in meters
   * @returns {Cesium.Entity|null} The satellite entity
   */
  setSatellitePosition(id, { lat, lon, alt }) {
    if (!this.viewer) {
      console.warn('CesiumService: Cannot set satellite position, viewer not initialized');
      return null;
    }

    // Check if entity already exists
    let entity = this.satelliteEntities.get(id);

    if (entity) {
      // Update existing entity position
      entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    } else {
      // Create new satellite entity
      entity = this.viewer.entities.add({
        id: `satellite-${id}`,
        name: `Satellite ${id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        point: {
          pixelSize: 10,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2
        },
        label: {
          text: id,
          font: '14px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15)
        }
      });

      this.satelliteEntities.set(id, entity);
      console.log(`CesiumService: Created satellite entity ${id} at lat=${lat}, lon=${lon}, alt=${alt}`);
    }

    // Request render since we're using requestRenderMode
    this.requestRender();

    return entity;
  }

  /**
   * Set satellite trajectory using historical telemetry data
   * Uses SampledPositionProperty for smooth interpolation during playback
   * @param {string} id - Unique identifier for the satellite
   * @param {Array} telemetryData - Array of telemetry points with timestamp, lat, lon, alt
   */
  setSatelliteTrajectory(id, telemetryData) {
    if (!this.viewer) {
      console.warn('CesiumService: Cannot set trajectory, viewer not initialized');
      return;
    }

    if (!telemetryData || telemetryData.length === 0) {
      console.warn('CesiumService: No telemetry data provided for trajectory');
      return;
    }

    // Create a SampledPositionProperty for smooth interpolation
    const positionProperty = new Cesium.SampledPositionProperty();

    // Set forward and backward extrapolation to HOLD so satellite stays visible at data edges
    positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

    // Add all positions to the sampled property
    telemetryData.forEach(point => {
      const time = Cesium.JulianDate.fromDate(new Date(point.timestamp));
      const position = Cesium.Cartesian3.fromDegrees(
        point['position.longitude'],
        point['position.latitude'],
        point['position.altitude']
      );
      positionProperty.addSample(time, position);
    });

    // Set interpolation options for smooth movement
    positionProperty.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
    });

    // Update or create the satellite entity with the sampled position
    let entity = this.satelliteEntities.get(id);

    // Log data range for debugging
    const dataStart = telemetryData[0].timestamp;
    const dataEnd = telemetryData[telemetryData.length - 1].timestamp;
    console.log(`CesiumService: Setting trajectory with data range:`, {
      start: new Date(dataStart).toISOString(),
      end: new Date(dataEnd).toISOString(),
      startMs: dataStart,
      endMs: dataEnd,
      numPoints: telemetryData.length
    });

    if (entity) {
      // Update existing entity
      entity.position = positionProperty;
      // Remove availability restriction - satellite should always be visible with extrapolation
      entity.availability = undefined;
      console.log(`CesiumService: Updated existing entity ${id}, removed availability restrictions`);
    } else {
      // Create new entity with sampled position
      // NOTE: No availability property - entity is always available, position uses extrapolation
      entity = this.viewer.entities.add({
        id: `satellite-${id}`,
        name: `Satellite ${id}`,
        position: positionProperty,
        // availability omitted - entity always visible
        point: {
          pixelSize: 10,
          color: Cesium.Color.CYAN,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2
        },
        label: {
          text: id,
          font: '14px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -15)
        }
      });

      this.satelliteEntities.set(id, entity);
      console.log(`CesiumService: Created new entity ${id}, always available`);
    }

    // Create or update the trajectory path visualization
    this.setTrajectoryPath(id, telemetryData);

    console.log(`CesiumService: Set trajectory for ${id} with ${telemetryData.length} points`);
    this.requestRender();
  }

  /**
   * Create a visual trajectory path (polyline) for the satellite
   * @param {string} id - Unique identifier for the satellite
   * @param {Array} telemetryData - Array of telemetry points
   */
  setTrajectoryPath(id, telemetryData) {
    if (!this.viewer) {
      return;
    }

    // Remove existing trajectory if present
    const existingTrajectory = this.trajectoryEntities.get(id);
    if (existingTrajectory) {
      this.viewer.entities.remove(existingTrajectory);
    }

    // Build an array of positions for the polyline
    const positions = telemetryData.map(point =>
      Cesium.Cartesian3.fromDegrees(
        point['position.longitude'],
        point['position.latitude'],
        point['position.altitude']
      )
    );

    // Create polyline entity for the trajectory
    const trajectoryEntity = this.viewer.entities.add({
      id: `trajectory-${id}`,
      name: `${id} Trajectory`,
      polyline: {
        positions: positions,
        width: 2,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: Cesium.Color.CYAN.withAlpha(0.7)
        }),
        clampToGround: false
      }
    });

    this.trajectoryEntities.set(id, trajectoryEntity);
    console.log(`CesiumService: Created trajectory path for ${id}`);
  }

  /**
   * Remove a satellite entity by ID
   * @param {string} id - Unique identifier for the satellite
   */
  removeSatellite(id) {
    const entity = this.satelliteEntities.get(id);
    if (entity) {
      this.removeEntity(entity);
      this.satelliteEntities.delete(id);
      console.log(`CesiumService: Removed satellite entity ${id}`);
      this.requestRender();
    }

    // Also remove trajectory if present
    const trajectory = this.trajectoryEntities.get(id);
    if (trajectory) {
      this.viewer.entities.remove(trajectory);
      this.trajectoryEntities.delete(id);
      console.log(`CesiumService: Removed trajectory for ${id}`);
    }
  }

  /**
   * Clean up and destroy the viewer instance
   * Important for preventing memory leaks when component is unmounted
   */
  destroy() {
    if (this.viewer) {
      console.log('CesiumService: Destroying viewer');
      this.viewer.destroy();
      this.viewer = null;
      this.container = null;
    }
  }

  /**
   * Resize the viewer (useful for responsive layouts)
   */
  resize() {
    if (this.viewer) {
      this.viewer.resize();
      this.requestRender();
    }
  }
}

// Export a singleton instance
export default new CesiumService();
