import { Link } from 'react-router-dom'
import { t as translate, useI18n } from '../../lib/i18n'
import LegalLayout, { LegalSection } from './LegalLayout'

const SUPPORT_EMAIL = 'support@horizon.travel'
const APP_NAME = 'Horizon Travel CRM'
const EFFECTIVE = '22 November 2026'

export default function TermsOfServicePage() {
  useI18n()
  return (
    <LegalLayout
      title={translate('Terms of Service')}
      updated={translate('Last updated: {value0}', { value0: EFFECTIVE })}
    >
      <LegalSection title={translate('1. Agreement')}>
        <p>
          {translate(
            'These Terms of Service (“Terms”) govern access to and use of {value0} (the “Service”). By creating an account, signing in, or using the Service, you agree to these Terms.',
            { value0: APP_NAME },
          )}
        </p>
        <p>
          {translate('If you use the Service on behalf of a travel agency or organization, you represent that you have authority to bind that organization, and “you” includes that organization.')}
        </p>
      </LegalSection>

      <LegalSection title={translate('2. The Service')}>
        <p>
          {translate(
            'The Service is an operations workspace for travel agencies. It helps staff manage WhatsApp and website-chat enquiries, leads, supplier communication, quotations, and related workflows. Customers may receive secure quote links or portal access; they do not browse or purchase inventory inside the Service as a marketplace.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('3. Accounts')}>
        <ul>
          <li>{translate('You must provide accurate account information and keep credentials confidential.')}</li>
          <li>{translate('You are responsible for activity under your accounts, including staff accounts you approve.')}</li>
          <li>{translate('We may suspend or terminate access for security, abuse, non-payment, or Terms violations.')}</li>
        </ul>
      </LegalSection>

      <LegalSection title={translate('4. Acceptable use')}>
        <p>{translate('You agree not to:')}</p>
        <ul>
          <li>{translate('Use the Service unlawfully or to send spam, phishing, or deceptive messages.')}</li>
          <li>{translate('Attempt to access other agencies’ data or disrupt the Service.')}</li>
          <li>{translate('Misuse integrations (WhatsApp, Gmail, search providers, or similar) beyond authorized business use.')}</li>
          <li>{translate('Upload malware or content you do not have rights to process.')}</li>
          <li>{translate('Reverse engineer the Service except where applicable law allows.')}</li>
        </ul>
      </LegalSection>

      <LegalSection title={translate('5. Customer and travel data')}>
        <p>
          {translate(
            'You retain ownership of customer and operational content you submit to the Service. You grant us a limited license to host, process, and display that content solely to provide and improve the Service for your agency.',
          )}
        </p>
        <p>
          {translate(
            'You are responsible for having a lawful basis to collect and process customer data (including traveler details and messaging content) and for your own privacy notices to customers.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('6. Third-party services')}>
        <p>
          {translate(
            'The Service may connect to third parties such as Google/Gmail, WhatsApp providers, flight/hotel search APIs, hosting, and email delivery. Those services are governed by their own terms and privacy policies. We are not responsible for third-party outages or policy changes.',
          )}
        </p>
        <p>
          {translate(
            'If you connect Gmail, you authorize us to access and use mailbox data as described in our Privacy Policy, only to provide email features inside the CRM.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('7. Quotes and bookings')}>
        <p>
          {translate(
            'Quotes generated or shared through the Service are tools for the agency’s sales process. Prices may be indicative and subject to availability. Final booking and payment typically occur outside the Service unless you configure otherwise. Customer acceptance of a quote confirms interest; it does not by itself create a paid reservation unless your agency states otherwise in the quote.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('8. Intellectual property')}>
        <p>
          {translate(
            'The Service software, design, and branding are owned by us or our licensors. You may not copy, resell, or redistribute the Service except as allowed in writing.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('9. Disclaimer')}>
        <p>
          {translate(
            'THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT UNINTERRUPTED OR ERROR-FREE OPERATION, OR THAT THIRD-PARTY INTEGRATIONS WILL ALWAYS BE AVAILABLE.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('10. Limitation of liability')}>
        <p>
          {translate(
            'TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY. OUR TOTAL LIABILITY FOR CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE 3 MONTHS BEFORE THE CLAIM (OR USD 100 IF YOU PAID NOTHING).',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('11. Indemnity')}>
        <p>
          {translate(
            'You will defend and indemnify us against claims arising from your content, your customer communications, your misuse of the Service, or your violation of these Terms or applicable law.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('12. Changes and termination')}>
        <p>
          {translate(
            'We may update these Terms by posting a revised version with a new “Last updated” date. Continued use after changes become effective constitutes acceptance. Either party may stop using or providing the Service; provisions that should survive (including ownership, disclaimer, liability limits, and indemnity) will survive.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('13. Contact')}>
        <p>
          {translate('Questions about these Terms:')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <p>
          {translate('See also our')}{' '}
          <Link to="/privacy-policy">{translate('Privacy Policy')}</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
