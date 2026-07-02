# Escrow Agent (Unicity Sphere)

A standalone autonomous agent built on the Sphere SDK that acts as a peer-to-peer escrow service.
A buyer funds a deal, the agent holds the tokens, and releases them to the seller once a party
confirms — or refunds the buyer once both parties agree.

Built for Unicity's Epoch Four "Call for Builders," Payments and Markets track.

## Escrow policy

- Release: either the buyer or the seller alone can trigger release of funds to the seller.
- Refund: both the buyer and the seller must independently confirm before funds are returned to the buyer.
- Deal state lives in deals-data/deals.json (created automatically).

## Setup

npm install
cp .env.example .env
# fill in AGENT_NAMETAG and SPHERE_API_KEY

## Running the agent

npm start

On first run this creates a wallet, registers the agent's nametag (nasspay-agent), and prints
a recovery phrase — save it. The agent then listens for DMs and handles escrow commands.

## Commands (sent as DMs to the agent)

- new <sellerNametag> <amount> <coinId> <description...> — buyer creates a new deal
- fund <dealId> — buyer confirms payment was sent
- release <dealId> — buyer or seller releases held funds to the seller
- refund <dealId> — buyer or seller votes to refund; funds return once both vote
- status <dealId> — shows deal state (or all your deals if no ID given)

## Trying it locally with the CLI

The CLI (cli.js) spins up separate throwaway wallets so you can play buyer, seller, and agent
in three terminals.

Terminal 1: run the agent with npm start

Terminal 2 (buyer):
node cli.js buyeralice mint UCT 1000000
node cli.js buyeralice dm nasspay-agent "new sellerbob 100000 UCT test widget"
node cli.js buyeralice send nasspay-agent 100000 UCT
node cli.js buyeralice dm nasspay-agent "fund <dealId>"

Terminal 3 (seller):
node cli.js sellerbob dm nasspay-agent "release <dealId>"

Check balances any time with: node cli.js <nametag> balance

## Known limitations (v1)

- Funding is confirmed by the buyer's fund DM plus an aggregate balance check, not by matching
  a specific transfer ID to a deal.
- No timeout/auto-refund yet — deals stay open until a party acts.
- Single agent process handles all deals; no concurrency control beyond in-process JSON writes.
