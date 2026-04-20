"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter, useParams } from "next/navigation";
import Papa from "papaparse";
import { getFieldGroups } from "@/lib/enrichment-fields";
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Building2,
  Users,
} from "lucide-react";
import { TextRotate } from "@/app/components/text-rotate";
import { StarButton } from "@/app/components/star-button";
import { clsx } from "clsx";
import Image from "next/image";

const MAX_ROWS = 200;

const TABS = [
  { type: "company" as const, label: "Company", icon: Building2 },
  { type: "people"  as const, label: "People",  icon: Users },
];

export default function EnrichPage() {
  const params    = useParams();
  const type      = params.type as "company" | "people";
  const router    = useRouter();
  const isCompany = type === "company";

  const [csvContent,       setCsvContent]       = useState("");
  const [fileName,         setFileName]         = useState("");
  const [rowCount,         setRowCount]         = useState(0);
  const [headers,          setHeaders]          = useState<string[]>([]);
  const [identifierColumn, setIdentifierColumn] = useState("");
  const [selectedFields,   setSelectedFields]   = useState<string[]>([]);
  const [isSubmitting,     setIsSubmitting]     = useState(false);
  const [error,            setError]            = useState("");

  const fieldGroups = getFieldGroups(type);
  const allFields   = fieldGroups.flatMap((g) => g.fields);

  const resetForm = () => {
    setCsvContent("");
    setFileName("");
    setRowCount(0);
    setHeaders([]);
    setIdentifierColumn("");
    setSelectedFields([]);
    setError("");
  };

  const switchTab = (newType: "company" | "people") => {
    if (newType === type) return;
    resetForm();
    router.push(`/enrich/${newType}`);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: true,
      });
      const cols  = parsed.meta.fields ?? [];
      const count = parsed.data.length;

      if (count > MAX_ROWS) {
        setError(`This file has ${count} rows — the maximum is ${MAX_ROWS}. Trim your CSV and try again.`);
        setCsvContent("");
        setHeaders([]);
        setRowCount(0);
        return;
      }

      setCsvContent(content);
      setHeaders(cols);
      setIdentifierColumn(cols[0] ?? "");
      setRowCount(count);
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
  });

  const toggleField = (key: string) =>
    setSelectedFields((p) => p.includes(key) ? p.filter((f) => f !== key) : [...p, key]);

  const allSelected = selectedFields.length === allFields.length;
  const toggleAll   = () => setSelectedFields(allSelected ? [] : allFields.map((f) => f.key));

  const handleSubmit = async () => {
    if (!csvContent)            return setError("No CSV loaded — drop a file above to get started.");
    if (!identifierColumn)      return setError("Pick the column that contains the identifier.");
    if (!selectedFields.length) return setError("Select at least one field to enrich.");

    setError("");
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, csvContent, identifierColumn, requestedFields: selectedFields }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error?.includes("column")
            ? `Column "${identifierColumn}" wasn't found in the CSV — check your header row for typos.`
            : (data.error ?? "Something went wrong. Try again.")
        );
        return;
      }
      router.push(`/results/${data.jobId}`);
    } catch {
      setError("Can't reach the server — check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">

      {/* Animated heading */}
      <div className="space-y-2 py-2">
        <div className="flex items-baseline gap-3 overflow-hidden">
          <span className="text-3xl font-serif font-bold text-gray-900 tracking-tight">Enrich</span>
          <TextRotate
            texts={["Company", "People"]}
            initialIndex={isCompany ? 0 : 1}
            auto={false}
            animatePresenceInitial={true}
            splitBy="characters"
            staggerDuration={0.03}
            staggerFrom="first"
            mainClassName="text-3xl font-serif font-bold tracking-tight text-brand-500 overflow-hidden"
            elementLevelClassName="overflow-hidden"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 font-medium">Powered by</span>
          <Image src="/claude-icon.png" alt="Claude" width={18} height={18} className="rounded-md" />
          <span className="text-xs font-semibold text-gray-700">Claude</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-cloudy/20 p-1 rounded-xl w-fit">
        {TABS.map(({ type: t, label, icon: Icon }) => {
          const active = t === type;
          return (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={clsx(
                "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <Icon className={clsx("w-4 h-4", active ? "text-brand-500" : "text-cloudy")} strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-xl border border-cloudy/30 overflow-hidden">
        <div className="px-6 py-4 border-b border-cloudy/20">
          <h2 className="text-sm font-semibold text-gray-700">Upload your CSV</h2>
        </div>
        <div className="p-6 space-y-4">
          <div
            {...getRootProps()}
            className={clsx(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-150",
              isDragActive
                ? "border-brand-400 bg-brand-50"
                : fileName && csvContent
                ? "border-cloudy/40 bg-pampas"
                : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
            )}
          >
            <input {...getInputProps()} />
            {fileName && csvContent ? (
              <div className="flex items-center justify-center gap-3">
                <FileSpreadsheet className="w-6 h-6 text-brand-500 flex-shrink-0" strokeWidth={1.75} />
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">{fileName}</p>
                  <p className="text-xs text-cloudy mt-0.5">
                    {rowCount} {rowCount === 1 ? "row" : "rows"} · {headers.length} columns
                    <span className="ml-2 text-brand-500 cursor-pointer">Replace file</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-7 h-7 text-cloudy" strokeWidth={1.5} />
                <div>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-brand-500">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-cloudy mt-0.5">CSV files only · up to {MAX_ROWS} rows</p>
                </div>
              </div>
            )}
          </div>

          {headers.length > 0 && csvContent && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {isCompany ? "Which column contains the company URL?" : "Which column contains the LinkedIn profile URL?"}
              </label>
              <select
                value={identifierColumn}
                onChange={(e) => setIdentifierColumn(e.target.value)}
                className="w-full bg-white border border-cloudy/40 text-gray-900 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Fields card */}
      <div className="bg-white rounded-xl border border-cloudy/30 overflow-hidden">
        <div className="px-6 py-4 border-b border-cloudy/20 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Choose fields to enrich</h2>
          <button
            onClick={toggleAll}
            className="text-xs text-brand-500 hover:text-brand-600 font-medium transition-colors"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="p-6 space-y-5">
          {fieldGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[11px] font-semibold text-cloudy uppercase tracking-wider mb-2">{group.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.fields.map((f) => {
                  const checked = selectedFields.includes(f.key);
                  return (
                    <label
                      key={f.key}
                      className={clsx(
                        "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-100 select-none",
                        checked ? "bg-brand-50 border-brand-200" : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
                      )}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        <div className={clsx(
                          "w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-100",
                          checked ? "bg-brand-500 border-brand-500" : "border-cloudy bg-white"
                        )}>
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                              <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-800">{f.label}</span>
                          {f.requiresProspeo && (
                            <span
                              className="cursor-help"
                              title="Looked up via Prospeo.io — requires PROSPEO_API_KEY in .env.local"
                            >
                              <Image src="/prospeo-icon.png" alt="Prospeo" width={16} height={16} className="rounded-sm" />
                            </span>
                          )}
                        </div>
                      </div>
                      <input type="checkbox" checked={checked} onChange={() => toggleField(f.key)} className="sr-only" aria-label={f.label} />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center gap-4 pb-8">
        <StarButton
          onClick={handleSubmit}
          disabled={!csvContent || isSubmitting}
          loading={isSubmitting}
          label={
            isSubmitting
              ? "Starting…"
              : selectedFields.length > 0
              ? `Start enrichment · ${selectedFields.length} field${selectedFields.length !== 1 ? "s" : ""}`
              : "Start enrichment"
          }
        />
        {rowCount > 0 && selectedFields.length > 0 && (
          <span className="text-xs text-cloudy">
            {rowCount} rows · ~{Math.max(1, Math.ceil(rowCount * 1.5))} min estimated
          </span>
        )}
      </div>

    </div>
  );
}
