import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageTitle } from '@/components/bits'
import { ReadPassport } from '@/components/read-passport'

export function Verify() {
  const [params, setParams] = useSearchParams()
  const current = params.get('passportId') ?? ''
  const [input, setInput] = useState(current)

  function submit(event: FormEvent) {
    event.preventDefault()
    const passportId = input.trim()
    if (passportId === '') return
    setParams({ passportId })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageTitle title="Verify a passport" description="Paste the identifier printed on the product or read from its QR code. The report is one answer per check; there is no overall score." />
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://host/01/<gtin>/21/<serial>" aria-label="Passport identifier" required spellCheck={false} />
        <Button type="submit">Verify</Button>
      </form>
      {current === '' ? null : <ReadPassport key={current} passportId={current} manageLink publicLink />}
    </div>
  )
}
