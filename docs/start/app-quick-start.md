# Application quick start

Use Node.js 22.23.4 and npm. The starter installs its dependencies and creates an application in `my-dpp`.

## Create and test the app

```sh
npm create @bsv/dpp-app
cd my-dpp
npm test
```

The tests exercise the passport lifecycle locally. They run without a funded wallet.

## Issue and view a local passport

```sh
npm run dev
```

Open the **Local** URL printed in the terminal. With the development defaults, choose **Your brands**, **Development brand**, then **Issue a passport**. Select `general@2`, enter `000000001` for **Item reference** and `DEMO-001` for **Serial**, and issue the sample. Open **Public page** to see the product and its verification results. The development wallet and index keep this exercise off chain.

## Go live on testnet

The published starter, `0.1.0-beta.1`, uses manual setup. Set `NETWORK=test` before creating or funding the wallet and follow the [published starter’s testnet setup](../packages/create-dpp-app.md#run-the-published-starter-on-testnet-or-mainnet) to connect a compatible index.

The November source candidate includes the following command. Run it from a project generated with that candidate after configuring its wallet and index.

```sh
npm run go-live
```

The command checks wallet funding and publisher admission. See the [candidate setup](../packages/create-dpp-app.md#run-the-november-source-candidate) for the compatible index and registration requirements.
