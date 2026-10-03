import type { AnyDb } from "@kdone/db";
import { type BookEvent, type JobType } from "@kdone/shared";
import { Orchestrator, Worker } from "@kdone/jobs";
import type { Queue } from "@kdone/jobs";
import { type ImageProvider, type LLMProvider, type ResearchProvider } from "@kdone/ai";
import { type StorageProvider } from "@kdone/storage";
import { KDPProvider } from "@kdone/publishing";
import { type MetadataOutput } from "@kdone/validation";
export interface KDoneDeps {
    db: AnyDb;
    queue: Queue;
    llm?: LLMProvider;
    researchProvider?: ResearchProvider;
    imageProvider?: ImageProvider;
    storage?: StorageProvider;
}
export declare class KDone {
    readonly db: AnyDb;
    readonly queue: Queue;
    readonly llm: LLMProvider;
    readonly researchProvider: ResearchProvider;
    readonly imageProvider: ImageProvider;
    readonly storage: StorageProvider;
    readonly orchestrator: Orchestrator;
    readonly worker: Worker;
    readonly kdp: KDPProvider;
    constructor(deps: KDoneDeps);
    private ctx;
    requireBook(bookId: string, userId: string): Promise<{
        topic: string | null;
        status: "DRAFT" | "RESEARCHING" | "RESEARCH_READY" | "PLANNING" | "PLAN_READY" | "WRITING" | "EDITING" | "PRODUCTION" | "QA" | "READY_FOR_REVIEW" | "USER_APPROVED" | "PUBLISHING" | "SUBMITTED" | "LIVE" | "FAILED" | "NEEDS_REVISION" | "BLOCKED" | "CANCELLED";
        authorName: string | null;
        id: string;
        userId: string;
        workingTitle: string | null;
        targetReader: string | null;
        genre: string | null;
        desiredLength: number | null;
        toneStyle: string | null;
        publisherName: string | null;
        currentResearchProjectId: string | null;
        currentPlanId: string | null;
        currentManuscriptId: string | null;
        currentMetadataId: string | null;
        currentCoverAssetId: string | null;
        currentEpubAssetId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    createBook(userId: string, input: {
        workingTitle: string;
        topic: string;
        targetReader?: string;
        genre?: string;
        desiredLength?: number;
        toneStyle?: string;
        authorName?: string;
    }): Promise<{
        topic: string | null;
        status: "DRAFT" | "RESEARCHING" | "RESEARCH_READY" | "PLANNING" | "PLAN_READY" | "WRITING" | "EDITING" | "PRODUCTION" | "QA" | "READY_FOR_REVIEW" | "USER_APPROVED" | "PUBLISHING" | "SUBMITTED" | "LIVE" | "FAILED" | "NEEDS_REVISION" | "BLOCKED" | "CANCELLED";
        authorName: string | null;
        id: string;
        userId: string;
        workingTitle: string | null;
        targetReader: string | null;
        genre: string | null;
        desiredLength: number | null;
        toneStyle: string | null;
        publisherName: string | null;
        currentResearchProjectId: string | null;
        currentPlanId: string | null;
        currentManuscriptId: string | null;
        currentMetadataId: string | null;
        currentCoverAssetId: string | null;
        currentEpubAssetId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    startResearch(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    approveResearch(bookId: string, userId: string): Promise<{
        researchProjectId: string | null;
        nextStatus: string;
    }>;
    getResearch(bookId: string, userId: string): Promise<{
        project: {
            status: string;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            researchBrief: string | null;
            marketSummary: string | null;
            readerProblemSummary: string | null;
            completedAt: Date | null;
        };
        sources: {
            title: string | null;
            status: string | null;
            id: string;
            createdAt: Date;
            researchProjectId: string;
            url: string | null;
            sourceName: string | null;
            publishedAt: Date | null;
            accessedAt: Date;
            sourceType: string | null;
            extractedContent: string | null;
        }[];
        findings: {
            id: string;
            createdAt: Date;
            researchProjectId: string;
            sourceId: string | null;
            findingType: string | null;
            statement: string;
            confidence: string | null;
            notes: string | null;
        }[];
    } | null>;
    startPlanning(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    approvePlan(bookId: string, userId: string): Promise<{
        nextStatus: string;
    }>;
    getPlan(bookId: string, userId: string): Promise<{
        plan: {
            title: string | null;
            targetWordCount: number | null;
            status: string;
            subtitle: string | null;
            positioning: string | null;
            bookPromise: string | null;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            outline: unknown;
        };
        chapters: {
            title: string | null;
            targetWordCount: number | null;
            ordinal: number;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            bookProjectId: string;
            objective: string | null;
            currentDraftId: string | null;
        }[];
    } | null>;
    /** One job per chapter. The book is never generated in a single call. */
    startWriting(bookId: string, userId: string, chapterOrdinals?: number[]): Promise<{
        jobIds: string[];
    }>;
    getManuscript(bookId: string, userId: string): Promise<{
        status: string;
        id: string;
        createdAt: Date;
        bookProjectId: string;
        version: number;
        assembledContent: unknown;
        wordCount: number;
    } | null>;
    runQa(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    listIssues(bookId: string, userId: string): Promise<{
        message: string;
        status: "open" | "accepted" | "rejected" | "resolved";
        id: string;
        createdAt: Date;
        updatedAt: Date;
        bookProjectId: string;
        chapterId: string | null;
        severity: "critical" | "warning" | "suggestion";
        issueType: string;
        location: string | null;
        proposedFix: string | null;
    }[]>;
    updateIssue(issueId: string, userId: string, patch: {
        status?: string;
        proposedFix?: string;
    }): Promise<{
        id: string;
        bookProjectId: string;
        chapterId: string | null;
        severity: "critical" | "warning" | "suggestion";
        issueType: string;
        message: string;
        location: string | null;
        proposedFix: string | null;
        status: "open" | "accepted" | "rejected" | "resolved";
        createdAt: Date;
        updatedAt: Date;
    }>;
    openCriticalCount(bookId: string): Promise<number>;
    generateCover(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    generateMetadata(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    updateMetadata(bookId: string, userId: string, patch: Partial<MetadataOutput>): Promise<{
        title: string | null;
        audience: unknown;
        subtitle: string | null;
        description: string | null;
        authorNames: unknown;
        keywords: unknown;
        categories: unknown;
        language: string | null;
        rights: string | null;
        price: string | null;
        aiDisclosure: string | null;
        id: string;
        publisherName: string | null;
        createdAt: Date;
        bookProjectId: string;
        version: number;
    }>;
    generateEpub(bookId: string, userId: string): Promise<import("@kdone/jobs").EnqueuedJob>;
    listAssets(bookId: string, userId: string): Promise<{
        mimeType: string | null;
        id: string;
        createdAt: Date;
        bookProjectId: string;
        version: number;
        assetType: "cover" | "epub" | "manuscript" | "preview" | "other";
        storageKey: string;
        sizeBytes: number | null;
        provenanceId: string | null;
    }[]>;
    previewManifest(bookId: string, userId: string): Promise<{
        book: {
            id: string;
            status: "DRAFT" | "RESEARCHING" | "RESEARCH_READY" | "PLANNING" | "PLAN_READY" | "WRITING" | "EDITING" | "PRODUCTION" | "QA" | "READY_FOR_REVIEW" | "USER_APPROVED" | "PUBLISHING" | "SUBMITTED" | "LIVE" | "FAILED" | "NEEDS_REVISION" | "BLOCKED" | "CANCELLED";
            workingTitle: string | null;
        };
        manuscript: {
            status: string;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assembledContent: unknown;
            wordCount: number;
        } | null;
        metadata: {
            title: string | null;
            audience: unknown;
            subtitle: string | null;
            description: string | null;
            authorNames: unknown;
            keywords: unknown;
            categories: unknown;
            language: string | null;
            rights: string | null;
            price: string | null;
            aiDisclosure: string | null;
            id: string;
            publisherName: string | null;
            createdAt: Date;
            bookProjectId: string;
            version: number;
        } | null;
        cover: {
            mimeType: string | null;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assetType: "cover" | "epub" | "manuscript" | "preview" | "other";
            storageKey: string;
            sizeBytes: number | null;
            provenanceId: string | null;
        } | null;
        epub: {
            mimeType: string | null;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assetType: "cover" | "epub" | "manuscript" | "preview" | "other";
            storageKey: string;
            sizeBytes: number | null;
            provenanceId: string | null;
        } | null;
        issues: {
            message: string;
            status: "open" | "accepted" | "rejected" | "resolved";
            id: string;
            createdAt: Date;
            updatedAt: Date;
            bookProjectId: string;
            chapterId: string | null;
            severity: "critical" | "warning" | "suggestion";
            issueType: string;
            location: string | null;
            proposedFix: string | null;
        }[];
        openCritical: number;
    }>;
    /** Final readiness gate. The only path from QA to READY_FOR_REVIEW (ADR-011). */
    preflight(bookId: string, userId: string): Promise<{
        passed: boolean;
        checks: import("@kdone/agents").PreflightCheck[];
    }>;
    /** Builds the artifact snapshot an approval binds to (ADR-013). */
    buildApprovalSnapshot(bookId: string): Promise<{
        manuscriptId: string;
        metadataId: string;
        coverAssetId: string;
        epubAssetId: string;
        provenanceFingerprint: string;
        provenanceCount: number;
        metadata: {
            title: string | null;
            audience: unknown;
            subtitle: string | null;
            description: string | null;
            authorNames: unknown;
            keywords: unknown;
            categories: unknown;
            language: string | null;
            rights: string | null;
            price: string | null;
            aiDisclosure: string | null;
            id: string;
            publisherName: string | null;
            createdAt: Date;
            bookProjectId: string;
            version: number;
        } | null;
        cover: {
            mimeType: string | null;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assetType: "cover" | "epub" | "manuscript" | "preview" | "other";
            storageKey: string;
            sizeBytes: number | null;
            provenanceId: string | null;
        } | null;
        epub: {
            mimeType: string | null;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assetType: "cover" | "epub" | "manuscript" | "preview" | "other";
            storageKey: string;
            sizeBytes: number | null;
            provenanceId: string | null;
        } | null;
        manuscriptRow: {
            status: string;
            id: string;
            createdAt: Date;
            bookProjectId: string;
            version: number;
            assembledContent: unknown;
            wordCount: number;
        } | null;
    }>;
    approve(bookId: string, userId: string): Promise<{
        id: string;
        bookProjectId: string;
        manuscriptId: string;
        metadataId: string;
        coverAssetId: string;
        epubAssetId: string;
        provenanceFingerprint: string;
        approvedBy: string;
        approvedAt: Date;
    }>;
    latestApproval(bookId: string): Promise<{
        id: string;
        bookProjectId: string;
        manuscriptId: string;
        metadataId: string;
        coverAssetId: string;
        epubAssetId: string;
        provenanceFingerprint: string;
        approvedBy: string;
        approvedAt: Date;
    } | null>;
    /**
     * Mode A (prepare). Refuses when the current artifact set has drifted from
     * the approval snapshot (ADR-013). In prepare-only mode the book stays in
     * USER_APPROVED, which is terminal (ADR-012).
     */
    publishStart(bookId: string, userId: string, checklistConfirmed?: string[]): Promise<{
        publishingJobId: string;
        mode: "prepare";
        bookStatus: "USER_APPROVED";
        manifest: {
            schemaVersion: 1;
            provider: string;
            mode: "prepare";
            preparedAt: string;
            artifacts: import("@kdone/publishing").PublishingArtifact;
            disclosure: {
                aiDisclosure: MetadataOutput["aiDisclosure"];
                requiresDisclosure: boolean;
                statement: string;
            };
            checklist: Array<{
                item: string;
                confirmed: boolean;
            }>;
        };
        fieldMapping: Record<string, string>;
    }>;
    publishStatus(bookId: string, userId: string): Promise<{
        bookStatus: "DRAFT" | "RESEARCHING" | "RESEARCH_READY" | "PLANNING" | "PLAN_READY" | "WRITING" | "EDITING" | "PRODUCTION" | "QA" | "READY_FOR_REVIEW" | "USER_APPROVED" | "PUBLISHING" | "SUBMITTED" | "LIVE" | "FAILED" | "NEEDS_REVISION" | "BLOCKED" | "CANCELLED";
        job: {
            status: string;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            bookProjectId: string;
            provider: string;
            mode: "prepare" | "assisted" | "automated";
            externalReference: string | null;
            packageStorageKey: string | null;
        } | null;
        events: {
            id: string;
            createdAt: Date;
            publishingJobId: string;
            eventType: string;
            details: unknown;
        }[];
    }>;
    /**
     * User edit or regeneration of a chapter. Appends a new immutable draft
     * version (never overwrites), re-assembles the manuscript as a new version,
     * and invalidates any approval via ADR-021.
     */
    editChapter(chapterId: string, userId: string, content?: string): Promise<{
        chapterId: string;
        manuscriptId: string | null;
        bookStatus: "DRAFT" | "RESEARCHING" | "RESEARCH_READY" | "PLANNING" | "PLAN_READY" | "WRITING" | "EDITING" | "PRODUCTION" | "QA" | "READY_FOR_REVIEW" | "USER_APPROVED" | "PUBLISHING" | "SUBMITTED" | "LIVE" | "FAILED" | "NEEDS_REVISION" | "BLOCKED" | "CANCELLED" | undefined;
    }>;
    listJobs(bookId: string, userId: string): Promise<{
        jobId: string;
        jobType: "editorial" | "fact_check" | "consistency" | "metadata" | "cover" | "research" | "planning" | "writing" | "qa" | "preflight" | "epub" | "publishing";
        status: "FAILED" | "CANCELLED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "RETRYING";
        progress: number | null;
        message: string | null;
        attempts: number;
        queuedAt: Date;
        startedAt: Date | null;
        completedAt: Date | null;
    }[]>;
    /**
     * Publishing settings for a user. `aiDisclosure` is a default preference and
     * never drives publishing behaviour (ADR-014).
     */
    getPublishingSettings(userId: string): Promise<{
        language: string | null;
        price: string | null;
        aiDisclosure: string | null;
        id: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        primaryMarketplace: string | null;
        rightsChoice: string | null;
        currency: string | null;
        kdpSelectPreference: boolean | null;
        drmPreference: string | null;
    }>;
    private registerHandlers;
    /**
     * Loads a book row with an explicit select.
     *
     * The Drizzle relational query API (`db.query.*`) requires `relations()`
     * definitions and stalls against PGlite without them, so all lookups use the
     * explicit select form.
     */
    private loadBook;
    private bookIdForJob;
    private chapterCount;
    private loadResearchOutput;
    private loadPlanOutput;
    private persistResearch;
    private persistPlan;
    private persistDraft;
    private loadPriorSummaries;
    private loadDraftChapters;
    /** Assembles a NEW immutable manuscript version from current drafts. */
    private assembleIfComplete;
    private collectDisclosures;
    private storeAsset;
    /** Runs every currently queued job for a book and waits for completion. */
    runQueuedJobs(): Promise<void>;
}
export type { BookEvent, JobType };
//# sourceMappingURL=lifecycle.d.ts.map