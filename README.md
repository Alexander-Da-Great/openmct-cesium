# Open MCT Cesium

A plugin for [Open MCT](https://nasa.github.io/openmct)
adding ceasium 3d  visualizations of telemetry data.
<img width="2065" height="1294" alt="Screenshot 2026-02-04 at 7 29 28 PM" src="https://github.com/user-attachments/assets/04d5eb16-c7eb-46d0-8cbb-ab13ec200978" />

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

