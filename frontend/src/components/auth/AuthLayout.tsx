import { t as translate, useI18n } from '../../lib/i18n'
import type { ReactNode } from 'react'
import LanguageSwitcher from '../LanguageSwitcher'

/** The "H" tile and name used above every signed-out screen. */
export function AuthBrand({ light = false }: { light?: boolean }) {
  useI18n()
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className={`grid size-9 place-items-center rounded-[9px] text-lg font-extrabold ${light ? 'bg-[#14B8A6] text-[#042F2E]' : 'bg-shop-accent text-white'}`}
      >
        H
      </div>
      <span className={`text-[17px] font-bold ${light ? 'text-white' : 'text-shop-ink'}`}>{translate("Horizon Travel")}</span>
    </div>
  )
}

/**
 * Sign-in layout (design system): a dark brand panel with the pitch on the left from tablet
 * width up, the form on the right. On a phone only the form shows, under the brand.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  useI18n()
  return (
    <div className="flex min-h-dvh flex-wrap bg-white text-shop-ink">
      <aside className="hidden flex-[1_1_520px] flex-col justify-between gap-10 bg-[#0F3D3A] p-14 text-[#E6FFFA] md:flex">
        <AuthBrand light />
        <div className="flex max-w-[460px] flex-col gap-5">
          <h2 className="text-[40px] leading-[1.1] font-extrabold tracking-[-0.02em] text-white">
            {translate("From WhatsApp enquiry to priced quote — in one workspace.")}</h2>
          <p className="text-base text-[#99F6E4]">
            {translate("Conversations, leads, dealer rates and quote delivery for the whole team.")}</p>
          <div
            aria-hidden="true"
            className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4"
          >
            <div className="flex justify-between gap-3">
              <span className="font-bold text-white">{translate("Sarah Ahmed · Dubai → Istanbul")}</span>
              <span className="rounded-full bg-[#CCFBF1] px-2 py-0.5 text-xs font-bold text-primary-800">{translate("Accepted")}</span>
            </div>
            <span className="text-[#99F6E4] tabular-nums">{translate("12–18 Dec · 2 adults, 1 child · USD 2,298")}</span>
          </div>
        </div>
        <span className="text-[13px] text-[#5EEAD4]">{translate("Staff access only. Customers receive quotes by secure link.")}</span>
      </aside>
      <main className="flex flex-[1_1_480px] flex-col items-center justify-center gap-8 px-6 py-12">
        <LanguageSwitcher />
        <div className="md:hidden">
          <AuthBrand />
        </div>
        {children}
      </main>
    </div>
  )
}
