import { t as translate, useI18n } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { FileUp, Plus } from 'lucide-react'
import PredefinedQuotesPanel from '../components/PredefinedQuotesPanel'
import Button from '../components/ui/Button'
import PageHeader from '../components/ui/PageHeader'
import { useSearch } from '../hooks/useSearch'

export default function QuotesPage() {
  useI18n()
  const { query, setPlaceholder } = useSearch()
  const [editorOpen, setEditorOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    setPlaceholder('Search by title or destination')
  }, [setPlaceholder])

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 pb-24 sm:p-6">
      <PageHeader
        title={translate("Quotes library")}
        subtitle="Reusable package templates. Customer quotes live inside each lead."
        actions={
          <>
            <Button icon={<FileUp />} onClick={() => setImportOpen(true)}>
              {translate("Import brochure")}</Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setEditorOpen(true)}>
              {translate("New template")}</Button>
          </>
        }
      />
      <PredefinedQuotesPanel
        query={query}
        editorOpen={editorOpen}
        importOpen={importOpen}
        onEditorOpenChange={setEditorOpen}
        onImportOpenChange={setImportOpen}
      />
    </div>
  )
}
