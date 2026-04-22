"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter, useParams } from "next/navigation";
import Papa from "papaparse";
import {
  getFieldGroups,
  LEAD_SCORE_REQUIRED_FIELDS,
  BUYING_TRIGGER_REQUIRED_FIELDS,
  BUYING_TRIGGER_SIGNAL_FIELDS,
} from "@/lib/enrichment-fields";
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Building2,
  Users,
  UserSearch,
  Target,
  Flame,
  Plus,
  X,
} from "lucide-react";
import { TextRotate } from "@/app/components/text-rotate";
import { StarButton } from "@/app/components/star-button";
import { clsx } from "clsx";
import Image from "next/image";

const MAX_ROWS = 200;
const MAX_ROWS_LEAD_SCORE = 500;

const TABS = [
  { type: "company"         as const, label: "Company",         icon: Building2 },
  { type: "people"          as const, label: "People",          icon: Users },
  { type: "decision_maker"  as const, label: "Decision Maker",  icon: UserSearch },
  { type: "lead_score"      as const, label: "Lead Score",      icon: Target },
  { type: "buying_trigger"  as const, label: "Buying Triggers", icon: Flame },
];

type EnrichType = "company" | "people" | "decision_maker" | "lead_score" | "buying_trigger";

const TIMEFRAME_OPTIONS = [
  { value: "last 30 days",   label: "Last 30 days" },
  { value: "last 3 months",  label: "Last 3 months" },
  { value: "last 6 months",  label: "Last 6 months" },
  { value: "last year",      label: "Last year" },
];

type CustomField = { name: string; description: string };

export default function EnrichPage() {
  const params    = useParams();
  const type      = params.type as EnrichType;
  const router    = useRouter();
  const isCompany      = type === "company";
  const isDM           = type === "decision_maker";
  const isLeadScore    = type === "lead_score";
  const isBuyingTrigger = type === "buying_trigger";
  const maxRows        = isLeadScore ? MAX_ROWS_LEAD_SCORE : MAX_ROWS;

  const [csvContent,       setCsvContent]       = useState("");
  const [fileName,         setFileName]         = useState("");
  const [rowCount,         setRowCount]         = useState(0);
  const [headers,          setHeaders]          = useState<string[]>([]);
  const [identifierColumn, setIdentifierColumn] = useState("");
  const [selectedFields,   setSelectedFields]   = useState<string[]>([]);
  const [customFields,     setCustomFields]     = useState<CustomField[]>([]);
  const [isSubmitting,     setIsSubmitting]     = useState(false);
  const [error,            setError]            = useState("");

  // Recent news params
  const [newsSelected,  setNewsSelected]  = useState(false);
  const [newsCount,     setNewsCount]     = useState(3);
  const [newsTimeframe, setNewsTimeframe] = useState("last 3 months");

  // Outreach first-line context
  const [outreachContext, setOutreachContext] = useState("");

  // Lead score rubric (only used for lead_score type)
  const [icpCriteria,   setIcpCriteria]   = useState("");
  const [painSignals,   setPainSignals]   = useState("");
  const [reachability,  setReachability]  = useState("");
  const [weightIcp,     setWeightIcp]     = useState(40);
  const [weightPain,    setWeightPain]    = useState(35);
  const [weightReach,   setWeightReach]   = useState(25);

  // Add field modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalName,   setModalName]   = useState("");
  const [modalDesc,   setModalDesc]   = useState("");
  const [modalError,  setModalError]  = useState("");

  const fieldGroups = getFieldGroups(type);
  const allFields   = fieldGroups.flatMap((g) => g.fields);

  const resetForm = () => {
    setCsvContent("");
    setFileName("");
    setRowCount(0);
    setHeaders([]);
    setIdentifierColumn("");
    setSelectedFields([]);
    setCustomFields([]);
    setNewsSelected(false);
    setNewsCount(3);
    setNewsTimeframe("last 3 months");
    setOutreachContext("");
    setIcpCriteria("");
    setPainSignals("");
    setReachability("");
    setWeightIcp(40);
    setWeightPain(35);
    setWeightReach(25);
    setError("");
  };

  const switchTab = (newType: EnrichType) => {
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

      if (count > maxRows) {
        setError(`This file has ${count} rows — the maximum is ${maxRows}. Trim your CSV and try again.`);
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
  }, [maxRows]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
  });

  const toggleField = (key: string) =>
    setSelectedFields((p) => p.includes(key) ? p.filter((f) => f !== key) : [...p, key]);

  const selectableFields = allFields.filter(
    (f) =>
      !f.isParameterized &&
      !(isLeadScore && LEAD_SCORE_REQUIRED_FIELDS.includes(f.key)) &&
      !(isBuyingTrigger && BUYING_TRIGGER_REQUIRED_FIELDS.includes(f.key))
  );
  const allStandardSelected = selectableFields.every((f) => selectedFields.includes(f.key));
  const toggleAll = () =>
    setSelectedFields(allStandardSelected ? [] : selectableFields.map((f) => f.key));

  const removeCustomField = (name: string) =>
    setCustomFields((prev) => prev.filter((f) => f.name !== name));

  const handleModalSave = () => {
    const trimmed = modalName.trim();
    if (!trimmed) return setModalError("Field name is required.");
    const existingNames = [
      ...allFields.map((f) => f.label.toLowerCase()),
      ...customFields.map((f) => f.name.toLowerCase()),
    ];
    if (existingNames.includes(trimmed.toLowerCase()))
      return setModalError("A field with this name already exists.");
    setCustomFields((p) => [...p, { name: trimmed, description: modalDesc.trim() }]);
    setModalName("");
    setModalDesc("");
    setModalError("");
    setIsModalOpen(false);
  };

  const handleModalCancel = () => {
    setModalName("");
    setModalDesc("");
    setModalError("");
    setIsModalOpen(false);
  };

  const newsFieldCount = newsSelected ? newsCount : 0;
  const leadScoreForcedFieldCount = isLeadScore
    ? LEAD_SCORE_REQUIRED_FIELDS.filter((f) => !selectedFields.includes(f)).length
    : 0;
  const hasAnyTriggerSignalSelected = selectedFields.some((f) =>
    BUYING_TRIGGER_SIGNAL_FIELDS.includes(f)
  );
  const buyingTriggerForcedFieldCount = isBuyingTrigger
    ? BUYING_TRIGGER_REQUIRED_FIELDS.filter((f) => !selectedFields.includes(f)).length +
      (hasAnyTriggerSignalSelected
        ? 0
        : BUYING_TRIGGER_SIGNAL_FIELDS.filter((f) => !selectedFields.includes(f)).length)
    : 0;
  const totalFieldCount =
    selectedFields.length +
    customFields.length +
    newsFieldCount +
    leadScoreForcedFieldCount +
    buyingTriggerForcedFieldCount;

  const weightsSum = weightIcp + weightPain + weightReach;
  const weightsValid = weightsSum === 100;

  const handleSubmit = async () => {
    if (!csvContent)       return setError("No CSV loaded — drop a file above to get started.");
    if (!identifierColumn) return setError("Pick the column that contains the identifier.");
    if (!isLeadScore && !isBuyingTrigger && !selectedFields.length && !customFields.length && !newsSelected)
      return setError("Select at least one field to enrich.");

    if (isLeadScore) {
      if (!icpCriteria.trim()) return setError("Define your ICP criteria before scoring — that's the anchor for the whole rubric.");
      if (!weightsValid)       return setError(`Weights must sum to 100 (currently ${weightsSum}).`);
    }

    // Expand recent_news into individual keys
    const newsKeys = newsSelected
      ? Array.from({ length: newsCount }, (_, i) => `recent_news_${i + 1}`)
      : [];

    setError("");
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          csvContent,
          identifierColumn,
          requestedFields: [...selectedFields, ...customFields.map((f) => f.name), ...newsKeys],
          customFieldDefs: customFields,
          newsParams: newsSelected ? { count: newsCount, timeframe: newsTimeframe } : undefined,
          outreachContext:
            (selectedFields.includes("first_line") || isBuyingTrigger) &&
            outreachContext.trim().length > 0
              ? outreachContext.trim()
              : undefined,
          scoreRubric: isLeadScore
            ? {
                icpCriteria:  icpCriteria.trim(),
                painSignals:  painSignals.trim(),
                reachability: reachability.trim(),
                weights: { icp: weightIcp, pain: weightPain, reach: weightReach },
              }
            : undefined,
        }),
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
          <span className="text-3xl font-serif font-bold text-gray-900 tracking-tight">
            {isLeadScore ? "Score" : isBuyingTrigger ? "Spot" : "Enrich"}
          </span>
          <TextRotate
            texts={["Company", "People", "Decision Maker", "Lead Score", "Buying Triggers"]}
            initialIndex={isCompany ? 0 : isDM ? 2 : isLeadScore ? 3 : isBuyingTrigger ? 4 : 1}
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
                  <p className="text-xs text-cloudy mt-0.5">CSV files only · up to {maxRows} rows</p>
                </div>
              </div>
            )}
          </div>

          {headers.length > 0 && csvContent && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {isCompany || isLeadScore || isBuyingTrigger
                  ? "Which column contains the company URL?"
                  : isDM
                  ? "Which column contains the business name?"
                  : "Which column contains the LinkedIn profile URL?"}
              </label>
              {isDM && (
                <p className="text-[11px] text-cloudy mt-1 mb-1.5">
                  Tip: include the city in the same column (e.g. <span className="font-medium">Joe&apos;s Pizza, Austin TX</span>) so the agent can disambiguate common names.
                </p>
              )}
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

      {/* Lead score rubric card */}
      {isLeadScore && (
        <div className="bg-white rounded-xl border border-cloudy/30 overflow-hidden">
          <div className="px-6 py-4 border-b border-cloudy/20">
            <h2 className="text-sm font-semibold text-gray-700">Scoring rubric</h2>
            <p className="text-xs text-cloudy mt-1">
              Define what a great lead looks like. The agent applies this rubric to every row and returns ICP Fit, Pain Signal, and Reachability scores with an explanation — then sorts them so you can work the top 50.
            </p>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="icp-criteria" className="text-sm font-medium text-gray-800">
                  ICP fit criteria <span className="text-red-500">*</span>
                </label>
                <span className="text-xs text-cloudy">{icpCriteria.length}/1000</span>
              </div>
              <p className="text-xs text-cloudy">
                Who is the ideal customer? Industry, size, geography, funding stage, segment — whatever matters. Specific &gt; generic.
              </p>
              <textarea
                id="icp-criteria"
                value={icpCriteria}
                onChange={(e) => setIcpCriteria(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="e.g. Series A–B B2B SaaS companies in martech or salestech, 50–500 employees, HQ in US/EU, selling to mid-market."
                className="w-full border border-cloudy/40 rounded-md px-3 py-2 text-sm placeholder:text-cloudy/70 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="pain-signals" className="text-sm font-medium text-gray-800">
                  Pain signals <span className="text-cloudy font-normal">(optional)</span>
                </label>
                <span className="text-xs text-cloudy">{painSignals.length}/1000</span>
              </div>
              <p className="text-xs text-cloudy">
                What observable evidence suggests they might be ready to buy? Hiring surges, funding, tech migrations, public complaints, growth markers.
              </p>
              <textarea
                id="pain-signals"
                value={painSignals}
                onChange={(e) => setPainSignals(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="e.g. Actively hiring SDRs or RevOps, raised in the last 12 months, expanding internationally, migrating from HubSpot to Salesforce, CEO/VP posting on LinkedIn about scaling the GTM team."
                className="w-full border border-cloudy/40 rounded-md px-3 py-2 text-sm placeholder:text-cloudy/70 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="reachability" className="text-sm font-medium text-gray-800">
                  Reachability preferences <span className="text-cloudy font-normal">(optional)</span>
                </label>
                <span className="text-xs text-cloudy">{reachability.length}/1000</span>
              </div>
              <p className="text-xs text-cloudy">
                Which contact paths matter to you? Named decision makers with active LinkedIn, public email, warm introducers — whatever makes a lead actually workable.
              </p>
              <textarea
                id="reachability"
                value={reachability}
                onChange={(e) => setReachability(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="e.g. Prefer named VP Sales / VP Marketing / Head of RevOps with an active personal LinkedIn and a public email on the company site. Avoid info@ only."
                className="w-full border border-cloudy/40 rounded-md px-3 py-2 text-sm placeholder:text-cloudy/70 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition resize-y"
              />
            </div>

            {/* Weights */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label className="text-sm font-medium text-gray-800">Weights</label>
                <span className={clsx("text-xs", weightsValid ? "text-cloudy" : "text-red-500 font-medium")}>
                  {weightsValid ? "Sums to 100" : `Must sum to 100 (currently ${weightsSum})`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "ICP Fit",      value: weightIcp,   set: setWeightIcp },
                  { label: "Pain Signal",  value: weightPain,  set: setWeightPain },
                  { label: "Reachability", value: weightReach, set: setWeightReach },
                ].map(({ label, value, set }) => (
                  <div key={label} className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-cloudy uppercase tracking-wider">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(e) => set(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                        className="w-full border border-cloudy/40 rounded-md px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                      />
                      <span className="text-xs text-cloudy">%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fields card */}
      <div className="bg-white rounded-xl border border-cloudy/30 overflow-hidden">
        <div className="px-6 py-4 border-b border-cloudy/20 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            {isLeadScore
              ? "Optional extra fields"
              : isBuyingTrigger
              ? "Which buying triggers should we hunt for?"
              : "Choose fields to enrich"}
          </h2>
          <button
            onClick={toggleAll}
            className="text-xs text-brand-500 hover:text-brand-600 font-medium transition-colors"
          >
            {allStandardSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="p-6 space-y-5">
          {isLeadScore && (
            <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2.5">
              <p className="text-xs font-medium text-gray-800">
                Scoring fields are always included:
              </p>
              <p className="text-[11px] text-cloudy mt-1 leading-relaxed">
                ICP Fit, Pain Signal, Reachability (scores + reasoning), Total Score, Priority Tier, and a human-readable Explanation column. Pick extra snapshot fields below if you want more context next to each score.
              </p>
            </div>
          )}
          {isBuyingTrigger && (
            <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2.5">
              <p className="text-xs font-medium text-gray-800">
                Heat score + outreach payload are always included:
              </p>
              <p className="text-[11px] text-cloudy mt-1 leading-relaxed">
                Trigger Count, Strongest Trigger, Trigger Summary, Heat Score (0–100), Heat Tier (A–D), Recommended Action, Outreach Angle, and a Personalized First Line that references the strongest trigger. Pick which trigger signals the agent should hunt for below — leave everything unchecked and it will run the full set.
              </p>
            </div>
          )}
          {fieldGroups
            .filter((group) => !(isLeadScore && group.label === "Lead Score"))
            .filter((group) => !(isBuyingTrigger && (group.label === "Heat Score" || group.label === "Outreach")))
            .map((group) => (
            <div key={group.label}>
              <p className="text-[11px] font-semibold text-cloudy uppercase tracking-wider mb-2">{group.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.fields.map((f) => {
                  if (f.isParameterized) {
                    // Parameterized field (Recent Company News)
                    return (
                      <div
                        key={f.key}
                        className={clsx(
                          "col-span-1 sm:col-span-2 rounded-lg border transition-all duration-100",
                          newsSelected ? "bg-brand-50 border-brand-200" : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
                        )}
                      >
                        {/* Checkbox row */}
                        <label className="flex items-start gap-3 p-3 cursor-pointer select-none">
                          <div className="mt-0.5 flex-shrink-0">
                            <div className={clsx(
                              "w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-100",
                              newsSelected ? "bg-brand-500 border-brand-500" : "border-cloudy bg-white"
                            )}>
                              {newsSelected && (
                                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                                  <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800">{f.label}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={newsSelected}
                            onChange={() => setNewsSelected((v) => !v)}
                            className="sr-only"
                            aria-label={f.label}
                          />
                        </label>

                        {/* Inline controls — only when selected */}
                        {newsSelected && (
                          <div className="px-3 pb-3 flex flex-wrap gap-4 border-t border-brand-100 pt-3">
                            <div className="flex items-center gap-2">
                              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">
                                How many?
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={newsCount}
                                onChange={(e) =>
                                  setNewsCount(Math.min(10, Math.max(1, Number(e.target.value))))
                                }
                                className="w-16 border border-cloudy/40 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs font-medium text-gray-600 whitespace-nowrap">
                                Time frame
                              </label>
                              <select
                                value={newsTimeframe}
                                onChange={(e) => setNewsTimeframe(e.target.value)}
                                className="border border-cloudy/40 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                              >
                                {TIMEFRAME_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <p className="w-full text-xs text-cloudy mt-0.5">
                              Will add {newsCount} column{newsCount !== 1 ? "s" : ""}: News 1{newsCount > 1 ? `, News 2${newsCount > 2 ? `, … News ${newsCount}` : ""}` : ""}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Standard field
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

          {/* Custom fields */}
          {customFields.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-cloudy uppercase tracking-wider mb-2">
                Custom Fields
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {customFields.map((cf) => (
                  <div
                    key={cf.name}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-amber-50 border-amber-200"
                  >
                    <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 bg-brand-500 border-brand-500 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-800">{cf.name}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase tracking-wide">
                          Custom
                        </span>
                      </div>
                      {cf.description && (
                        <p className="text-xs text-cloudy mt-0.5 truncate" title={cf.description}>
                          {cf.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => removeCustomField(cf.name)}
                      className="flex-shrink-0 mt-0.5 text-cloudy hover:text-red-500 transition-colors"
                      aria-label={`Remove ${cf.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add field button */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-600 font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add field
          </button>
        </div>
      </div>

      {/* Outreach context — shown when first-line is selected, or always for buying_trigger (outreach fields are forced) */}
      {(selectedFields.includes("first_line") || isBuyingTrigger) && (
        <div className="bg-white border border-cloudy/20 rounded-xl p-5 space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="outreach-context" className="text-sm font-semibold text-gray-900">
              Outreach context <span className="text-cloudy font-normal">(optional)</span>
            </label>
            <span className="text-xs text-cloudy">{outreachContext.length}/500</span>
          </div>
          <p className="text-xs text-cloudy">
            One or two sentences about what you&apos;re selling or your angle — the agent weaves this into the first line without turning it into a pitch.
          </p>
          <textarea
            id="outreach-context"
            value={outreachContext}
            onChange={(e) => setOutreachContext(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g. I run a service that helps home-services businesses turn missed phone calls into booked jobs via text."
            className="w-full border border-cloudy/40 rounded-md px-3 py-2 text-sm placeholder:text-cloudy/70 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition resize-y"
          />
        </div>
      )}

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
          disabled={
            !csvContent ||
            isSubmitting ||
            (isLeadScore && (!icpCriteria.trim() || !weightsValid))
          }
          loading={isSubmitting}
          label={
            isSubmitting
              ? "Starting…"
              : isLeadScore
              ? totalFieldCount > 0
                ? `Score & prioritize · ${totalFieldCount} field${totalFieldCount !== 1 ? "s" : ""}`
                : "Score & prioritize"
              : isBuyingTrigger
              ? totalFieldCount > 0
                ? `Find triggers & generate openers · ${totalFieldCount} field${totalFieldCount !== 1 ? "s" : ""}`
                : "Find triggers & generate openers"
              : totalFieldCount > 0
              ? `Start enrichment · ${totalFieldCount} field${totalFieldCount !== 1 ? "s" : ""}`
              : "Start enrichment"
          }
        />
        {rowCount > 0 && totalFieldCount > 0 && (
          <span className="text-xs text-cloudy">
            {rowCount} rows
          </span>
        )}
      </div>

      {/* Add field modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={handleModalCancel}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-900">Add custom field</h3>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">Field Name</label>
              <input
                autoFocus
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                placeholder="e.g. Headquarters Country"
                maxLength={60}
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleModalSave();
                  if (e.key === "Escape") handleModalCancel();
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-600">Extraction instructions</label>
              <textarea
                value={modalDesc}
                onChange={(e) => setModalDesc(e.target.value)}
                placeholder="e.g. The country where the company HQ is located"
                rows={3}
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>

            {modalError && <p className="text-xs text-red-600">{modalError}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={handleModalCancel}
                className="px-4 py-2 text-sm rounded-lg border border-cloudy/40 text-gray-600 hover:bg-pampas transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleModalSave}
                className="px-4 py-2 text-sm rounded-lg bg-brand-500 text-white hover:bg-brand-600 font-medium transition-colors"
              >
                Save field
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
