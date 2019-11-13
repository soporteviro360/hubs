// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");
const webpack = require("webpack");
const cors = require("cors");
const HTMLWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

function createHTTPSConfig() {
  // Generate certs for the local webpack-dev-server.
  if (fs.existsSync(path.join(__dirname, "certs"))) {
    const key = fs.readFileSync(path.join(__dirname, "certs", "key.pem"));
    const cert = fs.readFileSync(path.join(__dirname, "certs", "cert.pem"));

    return { key, cert };
  } else {
    const pems = selfsigned.generate(
      [
        {
          name: "commonName",
          value: "localhost"
        }
      ],
      {
        days: 365,
        algorithm: "sha256",
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              {
                type: 2,
                value: "localhost"
              },
              {
                type: 2,
                value: "hubs.local"
              }
            ]
          }
        ]
      }
    );

    fs.mkdirSync(path.join(__dirname, "certs"));
    fs.writeFileSync(path.join(__dirname, "certs", "cert.pem"), pems.cert);
    fs.writeFileSync(path.join(__dirname, "certs", "key.pem"), pems.private);

    return {
      key: pems.private,
      cert: pems.cert
    };
  }
}

const defaultHostName = "hubs.local";
const host = process.env.HOST_IP || defaultHostName;
const babelConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, ".babelrc")).toString());

module.exports = (env, argv) => ({
  entry: {
    admin: path.join(__dirname, "src", "admin.js")
  },
  output: {
    filename: "assets/js/[name]-[chunkhash].js",
    publicPath: process.env.BASE_ASSETS_PATH || ""
  },
  devtool: argv.mode === "production" ? "source-map" : "inline-source-map",
  devServer: {
    https: createHTTPSConfig(),
    host: process.env.HOST_IP || "0.0.0.0",
    port: process.env.PORT || "8989",
    public: `${host}:8989`,
    useLocalIp: true,
    allowedHosts: [host],
    headers: {
      "Access-Control-Allow-Origin": "*"
    },
    before: function(app) {
      // be flexible with people accessing via a local reticulum on another port
      app.use(cors({ origin: /hubs\.local(:\d*)?$/ }));
      // networked-aframe makes HEAD requests to the server for time syncing. Respond with an empty body.
      app.head("*", function(req, res, next) {
        if (req.method === "HEAD") {
          res.append("Date", new Date().toGMTString());
          res.send("");
        } else {
          next();
        }
      });
    }
  },
  performance: {
    // Ignore media and sourcemaps when warning about file size.
    assetFilter(assetFilename) {
      return !/\.(map|png|jpg|gif|glb|webm)$/.test(assetFilename);
    }
  },
  module: {
    rules: [
      {
        test: /\.html$/,
        loader: "html-loader"
      },
      {
        test: /\.js$/,
        loader: "babel-loader",
        options: babelConfig,
        exclude: function(modulePath) {
          return /node_modules/.test(modulePath) && !/node_modules\/hubs/.test(modulePath);
        }
      },
      {
        test: /\.worker\.js$/,
        loader: "worker-loader",
        options: {
          name: "assets/js/[name]-[hash].js",
          publicPath: "/",
          inline: true
        }
      },
      {
        test: /\.(scss|css)$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader
          },
          {
            loader: "css-loader",
            options: {
              name: "[path][name]-[hash].[ext]",
              localIdentName: "[name]__[local]__[hash:base64:5]",
              camelCase: true
            }
          },
          "sass-loader"
        ]
      },
      {
        test: /\.(glsl|frag|vert)$/,
        use: { loader: "raw-loader" }
      },
      {
        test: /\.(png|jpg|gif|glb|ogg|mp3|mp4|wav|woff2|svg|webm)$/,
        use: {
          loader: "file-loader",
          options: {
            // move required assets to output dir and add a hash for cache busting
            name: "[path][name]-[hash].[ext]",
            // Make asset paths relative to /src
            context: path.join(__dirname, "src")
          }
        }
      }
    ]
  },
  plugins: [
    new HTMLWebpackPlugin({
      filename: "admin.html",
      template: path.join(__dirname, "src", "admin.html")
    }),
    new CopyWebpackPlugin([
      {
        from: "src/assets/images/favicon.ico",
        to: "favicon.ico"
      }
    ]),
    // Extract required css and add a content hash.
    new MiniCssExtractPlugin({
      filename: "assets/stylesheets/[name]-[contenthash].css",
      disable: argv.mode !== "production"
    }),
    // Define process.env variables in the browser context.
    new webpack.DefinePlugin({
      "process.env": JSON.stringify({
        NODE_ENV: argv.mode,
        BUILD_VERSION: process.env.BUILD_VERSION,
        CONFIGURABLE_SERVICES: process.env.CONFIGURABLE_SERVICES,
        ITA_SERVER: process.env.ITA_SERVER,
        RETICULUM_SERVER: process.env.RETICULUM_SERVER,
        POSTGREST_SERVER: process.env.POSTGREST_SERVER
      })
    })
  ]
});
