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

The starter writes `.env` with the default testnet index. Run the following command from the app folder.

```sh
npm run go-live
```

The command requests publisher registration and checks wallet funding and index admission. It names the fix for each check that fails and enables publishing once every check passes. See [testnet and mainnet setup](../packages/create-dpp-app.md#run-on-testnet-or-mainnet) for the compatible index and registration requirements. An app created with the earlier `0.1.0-beta.1` starter has no go-live command: follow the [earlier starter’s setup](../packages/create-dpp-app.md#run-the-earlier-starter).
