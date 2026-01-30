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
      animation: false,
      timeline: false,
      baseLayerPicker: true,
      geocoder: true,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: true,
      infoBox: true,
      requestRenderMode: true, // Optimize rendering - only render when needed
      maximumRenderTimeChange: Infinity, // Prevent automatic rendering
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
