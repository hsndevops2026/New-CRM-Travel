import { Link } from 'react-router-dom'
import { t as translate, useI18n } from '../../lib/i18n'
import LegalLayout, { LegalSection } from './LegalLayout'

const SUPPORT_EMAIL = 'support@horizon.travel'
const APP_NAME = 'Horizon Travel CRM'
const EFFECTIVE = '22 November 2026'

export default function PrivacyPolicyPage() {
  useI18n()
  return (
    <LegalLayout
      title={translate('Privacy Policy')}
      updated={translate('Last updated: {value0}', { value0: EFFECTIVE })}
    >
      <LegalSection title={translate('1. Who we are')}>
        <p>
          {translate(
            '{value0} (“we”, “us”, “our”) provides an internal travel-agency operations workspace for staff. This Privacy Policy explains how we collect, use, store, and share information when you use our website and services, including the staff CRM, customer quote links, and related integrations.',
            { value0: APP_NAME },
          )}
        </p>
        <p>
          {translate('Contact:')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </LegalSection>

      <LegalSection title={translate('2. Information we collect')}>
        <p>{translate('Depending on how you use the service, we may process:')}</p>
        <ul>
          <li>
            <strong>{translate('Account information.')}</strong>{' '}
            {translate('Name, email address, role (staff or customer), and authentication credentials.')}
          </li>
          <li>
            <strong>{translate('Customer and travel data.')}</strong>{' '}
            {translate('Contact details, trip preferences, dates, traveler counts, quotes, bookings status, documents, and notes entered by agency staff.')}
          </li>
          <li>
            <strong>{translate('Messaging content.')}</strong>{' '}
            {translate('WhatsApp and website-chat conversations used to intake and progress travel enquiries.')}
          </li>
          <li>
            <strong>{translate('Email content (when connected).')}</strong>{' '}
            {translate('If a staff member connects Gmail, we access mailbox data needed to list, read, search, download attachments, and send email from the CRM on their behalf.')}
          </li>
          <li>
            <strong>{translate('Usage and technical data.')}</strong>{' '}
            {translate('Device/browser type, IP address, timestamps, and basic logs needed for security and reliability.')}
          </li>
        </ul>
      </LegalSection>

      <LegalSection title={translate('3. How we use information')}>
        <ul>
          <li>{translate('Provide and operate the CRM, quote sharing, and customer portal features.')}</li>
          <li>{translate('Help agency staff convert enquiries into priced quotations and follow up with customers.')}</li>
          <li>{translate('Send operational messages (for example WhatsApp or email quote delivery) on behalf of the agency.')}</li>
          <li>{translate('Authenticate users, prevent abuse, and maintain security.')}</li>
          <li>{translate('Improve reliability, support, and product quality.')}</li>
          <li>{translate('Comply with legal obligations.')}</li>
        </ul>
      </LegalSection>

      <LegalSection title={translate('4. Google / Gmail access')}>
        <p>
          {translate(
            'Staff may optionally connect a Google account so the CRM can read and send email. We request only the Google scopes needed for that feature. We do not use Gmail data for advertising, and we do not sell Gmail data.',
          )}
        </p>
        <p>
          {translate(
            'Gmail access tokens are stored encrypted on our servers. Staff can disconnect Gmail at any time from the Email page. Disconnecting removes our stored tokens for that account; it does not delete the mailbox in Google.',
          )}
        </p>
        <p>
          {translate(
            'Our use of information received from Google APIs complies with the Google API Services User Data Policy, including the Limited Use requirements.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('5. Sharing')}>
        <p>{translate('We may share information with:')}</p>
        <ul>
          <li>
            <strong>{translate('Service providers.')}</strong>{' '}
            {translate('Hosting, database, email delivery, messaging, and similar processors who act on our instructions.')}
          </li>
          <li>
            <strong>{translate('The travel agency that operates the workspace.')}</strong>{' '}
            {translate('Staff of that agency can access customer and operational data stored in their CRM instance.')}
          </li>
          <li>
            <strong>{translate('Legal authorities.')}</strong>{' '}
            {translate('When required by law or to protect rights, safety, and security.')}
          </li>
        </ul>
        <p>{translate('We do not sell personal information.')}</p>
      </LegalSection>

      <LegalSection title={translate('6. Retention')}>
        <p>
          {translate(
            'We retain information for as long as needed to provide the service, meet agency operational needs, resolve disputes, and comply with legal requirements. Agencies may delete customer or lead records from the CRM according to their internal processes.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('7. Security')}>
        <p>
          {translate(
            'We use administrative, technical, and organizational measures designed to protect personal data, including encrypted transport (HTTPS), access controls, and encrypted storage of sensitive tokens. No method of transmission or storage is completely secure.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('8. Your rights')}>
        <p>
          {translate(
            'Depending on your location, you may have rights to access, correct, delete, or export personal data, or to object to certain processing. Staff and customers should contact the operating agency first. You may also contact us at',
          )}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
        <p>
          {translate('If you connected Google, you can revoke access in your Google Account permissions at any time.')}
        </p>
      </LegalSection>

      <LegalSection title={translate('9. Children')}>
        <p>
          {translate(
            'The service is intended for business use by travel agencies and adults. It is not directed to children under 16, and we do not knowingly collect personal information from children for CRM accounts.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('10. Changes')}>
        <p>
          {translate(
            'We may update this Privacy Policy from time to time. The “Last updated” date at the top will change when we do. Continued use of the service after an update means you accept the revised policy.',
          )}
        </p>
      </LegalSection>

      <LegalSection title={translate('11. Contact')}>
        <p>
          {translate('Questions about this Privacy Policy:')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <p>
          {translate('See also our')}{' '}
          <Link to="/term-and-service">{translate('Terms of Service')}</Link>.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
