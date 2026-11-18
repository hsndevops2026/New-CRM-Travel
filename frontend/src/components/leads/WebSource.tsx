import { Globe } from 'lucide-react'
import { t as translate, useI18n } from '../../lib/i18n'
import { webSourceParts, type WebAttribution } from '../../lib/webchat'

export default function WebSource({ attribution, as = 'li' }: { attribution: WebAttribution | null | undefined; as?: 'li' | 'div' }) {
  useI18n()
  const parts = webSourceParts(attribution)
  if (!parts) return null
  const Tag = as
  return (
    <Tag className="flex min-w-0 items-center gap-1.5">
      <Globe className="size-4 shrink-0 text-shop-muted" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {parts.site ? (
          <>
            {translate('From the website')}{' '}
            {parts.page ? (
              <a href={parts.page} target="_blank" rel="noopener noreferrer nofollow" title={parts.pageTitle || parts.page} className="font-semibold text-shop-accent hover:underline">
                <bdi dir="ltr">{parts.site}</bdi>
              </a>
            ) : (
              <bdi dir="ltr" className="font-semibold">{parts.site}</bdi>
            )}
          </>
        ) : translate('From the website')}
        {parts.owner && (
          <>
            {' · '}
            {translate('chat of {value0}', { value0: parts.owner })}
          </>
        )}
        {parts.via && (
          <>
            {' · '}
            {translate('via')}{' '}
            <bdi dir="ltr">{parts.via}</bdi>
          </>
        )}
      </span>
    </Tag>
  )
}
