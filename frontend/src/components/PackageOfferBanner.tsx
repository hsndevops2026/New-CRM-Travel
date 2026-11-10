import { useEffect, useState } from 'react'
import Button from './ui/Button'
import {
  acceptPackageOffer,
  declinePackageOffer,
  fetchPackageOffer,
  type Lead,
  type PackageOfferInfo,
} from '../lib/leads'

type Props = {
  lead: Lead
  onUpdated: (lead: Lead) => void
}

export default function PackageOfferBanner({ lead, onUpdated }: Props) {
  const [offer, setOffer] = useState<PackageOfferInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchPackageOffer(lead.id)
      .then(setOffer)
      .catch(() => setOffer(null))
  }, [lead.id, lead.pending_package_offer_id])

  if (!offer?.pending || !offer.package) return null

  const handleAccept = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await acceptPackageOffer(lead.id)
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept package')
    } finally {
      setBusy(false)
    }
  }

  const handleDecline = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await declinePackageOffer(lead.id)
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline package')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
      <h2 className="text-sm font-semibold text-violet-900">Predefined package available</h2>
      <p className="mt-1 text-sm text-violet-800">
        <strong>{offer.package.title}</strong>
        {offer.package.destination ? ` · ${offer.package.destination}` : ''}
        {offer.package.nights ? ` · ${offer.package.nights} nights` : ''}
      </p>
      <p className="mt-1 text-xs text-violet-700">
        Accept to attach this package, or decline to search flights/hotels via APIs.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void handleAccept()}>
          {busy ? 'Working…' : 'Accept package'}
        </Button>
        <Button disabled={busy} onClick={() => void handleDecline()}>
          Search APIs instead
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  )
}
