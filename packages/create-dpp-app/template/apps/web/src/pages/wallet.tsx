import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CopyButton, DefinitionList, ErrorNotice, Field, Loading, Mono, PageTitle, YesNo } from '@/components/bits'
import { RequireAccount } from '@/components/layout'
import { api, type FundingAddress } from '@/lib/api'
import { useLoad } from '@/lib/use-load'

export function Wallet() {
  return (
    <RequireAccount>
      <WalletPage />
    </RequireAccount>
  )
}

function WalletPage() {
  const wallet = useLoad(() => api.wallet(), [])
  const [funding, setFunding] = useState<FundingAddress>()
  const [fundingBusy, setFundingBusy] = useState(false)
  const [fundingError, setFundingError] = useState<unknown>()
  const [txid, setTxid] = useState('')
  const [taking, setTaking] = useState(false)
  const [taken, setTaken] = useState<number>()
  const [takeError, setTakeError] = useState<unknown>()

  async function newAddress() {
    setFundingBusy(true)
    setFundingError(undefined)
    setTaken(undefined)
    try {
      setFunding(await api.fundingAddress())
    } catch (cause) {
      setFundingError(cause)
    } finally {
      setFundingBusy(false)
    }
  }

  async function takeIn(event: FormEvent) {
    event.preventDefault()
    if (funding == null) return
    setTaking(true)
    setTakeError(undefined)
    setTaken(undefined)
    try {
      const answer = await api.internalize(txid.trim(), funding)
      setTaken(answer.satoshis)
      setTxid('')
      wallet.reload()
    } catch (cause) {
      setTakeError(cause)
    } finally {
      setTaking(false)
    }
  }

  return (
    <div className="space-y-10">
      <PageTitle title="Wallet" description="The platform wallet publishes every state, holds the lock on every passport and pays the fees." />
      {wallet.loading ? (
        <Loading what="Loading the wallet" />
      ) : wallet.error != null || wallet.data == null ? (
        <ErrorNotice error={wallet.error ?? new Error('no answer')} title="Could not load the wallet" />
      ) : (
        <DefinitionList
          entries={[
            ['Kind', wallet.data.kind === 'toolbox' ? 'toolbox (a wallet with a root key)' : 'test (fixed keys, nothing reaches the chain)'],
            ['Network', wallet.data.network],
            [
              'Identity key',
              <span key="k" className="flex items-center gap-2">
                <Mono>{wallet.data.identityKey}</Mono>
                <CopyButton text={wallet.data.identityKey} label="Copy the identity key" />
              </span>,
            ],
            ['Balance', `${wallet.data.balance.toLocaleString()} satoshis`],
            [
              'Live publishing',
              <span key="l" className="flex flex-col gap-1">
                <YesNo value={wallet.data.livePublishing} />
                {wallet.data.livePublishing ? null : <span className="text-xs text-muted-foreground">LIVE_PUBLISHING is false: states are built, checked and admitted as drafts, then aborted before the send.</span>}
              </span>,
            ],
          ]}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fund the wallet</CardTitle>
            <CardDescription>A fresh address to pay. The platform derives the key for the prefix and suffix shown; keep both to take the payment in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={newAddress} disabled={fundingBusy} variant="outline">
              {fundingBusy ? 'Working' : 'New funding address'}
            </Button>
            {fundingError == null ? null : <ErrorNotice error={fundingError} title="No address" />}
            {funding == null ? null : (
              <DefinitionList
                entries={[
                  [
                    'Address',
                    <span key="a" className="flex items-center gap-2">
                      <Mono className="text-sm">{funding.address}</Mono>
                      <CopyButton text={funding.address} label="Copy the address" />
                    </span>,
                  ],
                  ['Derivation prefix', <Mono key="p">{funding.derivationPrefix}</Mono>],
                  ['Derivation suffix', <Mono key="s">{funding.derivationSuffix}</Mono>],
                  ['Sender identity key', <Mono key="i">{funding.senderIdentityKey}</Mono>],
                ]}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Take in a payment</CardTitle>
            <CardDescription>The txid of a payment to the last funding address above.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={takeIn} className="space-y-4">
              <Field label="Txid" htmlFor="txid" required help={funding == null ? 'Make a funding address first; the payment must go to it.' : `For the address ${funding.address}.`}>
                <Input id="txid" value={txid} onChange={(e) => setTxid(e.target.value)} required pattern="[0-9a-fA-F]{64}" spellCheck={false} disabled={funding == null} />
              </Field>
              {takeError == null ? null : <ErrorNotice error={takeError} title="Not taken in" />}
              {taken == null ? null : <p className="text-sm">Took in {taken.toLocaleString()} satoshis.</p>}
              <Button type="submit" disabled={taking || funding == null || txid.trim() === ''}>
                {taking ? 'Working' : 'Take in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
