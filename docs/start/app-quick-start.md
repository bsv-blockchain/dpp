# Application quick start

Use Node.js 22.23.4 and npm 11.19.0. The published starter (`0.1.0-beta.2`) creates `my-dpp`, installs its dependencies and writes a private `.env` configured for testnet.

## Create and test the app

```sh
npm create @bsv/dpp-app
cd my-dpp
npm test
```

The tests exercise the passport lifecycle locally using a development wallet. The first run downloads three GS1 reference files and a MongoDB test binary.

## Issue and view a local passport

```sh
npm run dev
```

Open the **Local** URL printed in the terminal. With the development defaults, choose **Your brands**, **Development brand**, then **Issue a passport**. Select `general@2`, enter `000000001` for **Item reference** and `DEMO-001` for **Serial**, and issue the sample. Open **Public page** to see the product and its verification results. The development wallet and index keep this exercise off chain.

## Go live on testnet

Stop the development server with `Ctrl+C`. In the generated project run the following command.

```sh
npm run go-live
```

The app opens its wallet, signs a publisher registration request and collects its tokens from the hosted testnet index. Registration is open. On the first run with an empty wallet, send testnet BSV to the **funding address** the command prints. You can obtain test coins from the [BSV testnet faucet](https://bsvfaucet.com/).

Use the payment transaction ID in the printed `npm run wallet fund` command, keeping the address and both derivation values from that payment. Run `npm run go-live` again. When the wallet has at least 500 satoshis and the index admits its publisher key, the app enables live publishing.

Restart `npm run dev` and issue another sample with a new serial. Open its public page to inspect the testnet transaction and its verification results. For mainnet or an existing beta.1 app, use the [starter network guide](../packages/create-dpp-app.md#run-on-testnet-or-mainnet).
