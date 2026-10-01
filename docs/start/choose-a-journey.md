# Choose a journey

There are two ways to build with the standard.

| You want to | Route | Start |
|---|---|---|
| Build an application or service, using the published packages | Use the packages. Most builders start here. | [Quick start](../quick-start.md), then [build an application](../packages/build-an-application.md) |
| Show that the rules can be implemented without our code | Write your own implementation from the specifications and test vectors | [Implementer start](../implement/README.md) |

Using the packages is the fast route: the packages already implement the rules, and your work is the wallet, the storage and the screens. [What a passport application offers](../packages/what-an-application-offers.md) lists those screens, who uses each and the package calls beneath it. Writing your own implementation is how the standard proves it does not depend on one codebase; your code must agree with the test vectors on every case, and a user interface built on top of the packages does not count as a separate implementation.

The [conformance specification](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/spec/conformance.md) and [governance](https://github.com/bsv-blockchain/dpp/blob/e65498a9570fbb5e859021225875fe7197a06f34/GOVERNANCE.md) say what an independence claim needs, and [reporting](../implement/reporting.md) explains how to present the evidence.

Whichever route you take, [choose a role](choose-a-role.md) next: reader, writer, issuer, registry or index.
