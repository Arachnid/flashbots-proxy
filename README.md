# Flashbots Proxy

This package provides an easy way to interactively build and submit flashbots bundles. In conjunction with an archive node, it presents an RPC endpoint that transparently forks the target network and accumulates transactions, before allowing you to submit them all as a batch to a Flashbots endpoint, or revert them all and start from scratch.

## Usage

```
git clone https://github.com/arachnid/flashbots-proxy.git
cd flashbots-proxy
yarn
yarn start [args]
```

Available command line arguments:

```
Options:
  -r --rpc <url>      RPC URL to proxy to (default: "http://localhost:8545/")
  -p --port <number>  Port number to listen on (default: "9545")
  -h, --help          display help for command
```

Once started, connect your wallet (eg, MetaMask) to the endpoint exposed by the proxy (by default, `http://localhost:9545/`), and interact with apps and contracts normally. When you send your first transaction, flashbots-proxy will transparently create a new Ganache fork, and submit your transaction to it. At this point, your view of the chain is frozen in time at the point where you sent your first transaction, with only your own changes visible.

As you send transactions, they will be displayed on the console like so:

```
1. 0xE0b604208176C9c991A310E242677dfFddd3ab4D -> 0x283Af0B28c62C092C9727F1Ee09c02CA627EB7F5
2. 0xE0b604208176C9c991A310E242677dfFddd3ab4D -> 0x283Af0B28c62C092C9727F1Ee09c02CA627EB7F5
(S)ubmit, (R)evert?
```

At any time, you can make another transaction, or enter 's' to submit the transactions as a bundle, or 'r' to revert.

Submitting will cause the command to send the accumulated transactions to Flashbots as a bundle for inclusion in the next block, and wait for it to be mined before returning. This can fail - see [Flashbots' article on bundle troubleshooting](https://docs.flashbots.net/flashbots-auction/searchers/advanced/troubleshooting) for why - in which case you can try again as many times as you wish.

Reverting will delete the Ganache fork, discard the transactions, and return you to a live view of the blockchain. After reverting, be sure to 'reset' your wallets so they do not have an out-of-date view of your accounts; in MetaMask you can do this by going to Settings -> Advanced -> Reset Account. You will need to repeat this for each account.

## Disclaimer

This code is brand new, pretty manky, and almost certainly contains errors. I take no responsibility for any damage it causes, and you use it entirely at your own risk.
