# Open MCT Cesium

A plugin for [Open MCT](https://nasa.github.io/openmct)
adding ceasium 3d  visualizations of telemetry data.

<img width="2282" height="1320" alt="Screenshot 2026-01-30 at 5 22 03 PM" src="https://github.com/user-attachments/assets/7692264f-7d6e-4c4a-8253-06567e2853f0" />

## Build

```bash
$ git clone https://github.com/Alexander-Da-Great/openmct-cesium.git
$ cd openmct-cesium
$ npm install
```

A UMD module with associated source maps will be written to the
`dist` folder. When installed as a global, the plugin will be
available as `CesiumPlugin`.

## Usage

See [`index.html`](index.html) for an example of use.

## Developer Environment

Follow build instructions, then trigger a build of `openmct`:

```bash
cd node_modules/openmct
npm install
cd ../..
```

To serve the application, use `webpack-dev-loader`:

```bash
npm install -g webpack webpack-dev-loader
webpack-dev-loader
```

There is an example `index.html` included which provides
a basic instance of Open MCT with this plugin installed for development
purposes.

