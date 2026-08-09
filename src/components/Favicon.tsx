import { useEffect, useState } from 'react'
import { getDomainInitial, makeFaviconUrl } from '../lib/bookmark-utils'

type FaviconProps = {
  url: string
}

export function Favicon({ url }: FaviconProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')

  useEffect(() => {
    setState('loading')
  }, [url])

  return (
    <span className={`site-mark site-mark--${state}`} aria-hidden="true">
      {state !== 'fallback' && (
        <img
          src={makeFaviconUrl(url)}
          alt=""
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('fallback')}
        />
      )}
      {state === 'loading' && <span className="site-mark__skeleton" />}
      {state === 'fallback' && <span className="site-mark__initial">{getDomainInitial(url)}</span>}
    </span>
  )
}

