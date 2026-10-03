import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  approvalEvents,
  bookAssets,
  bookMetadata,
  bookPlans,
  bookProjects,
  bookStateTransitions,
  bookSettings,
  chapters,
  chapterDrafts,
  editorialReviews,
  factChecks,
  generationJobs,
  manuscripts,
  preflightRuns,
  provenanceRecords,
  publishingEvents,
  publishingJobs,
  qualityIssues,
  researchFindings,
  researchProjects,
  researchSources,
  type GenerationJob,
} from "@kdone/db/schema";
import type { AnyDb } from "@kdone/db";
import { errors, provenanceFingerprint, type BookEvent, type JobType } from "@kdone/shared";
import { Orchestrator, Worker, type JobEnvelope, type WorkerContext, type WorkerHandlerResult } from "@kdone/jobs";
import type { Queue } from "@kdone/jobs";
import { defaultProviders, type ImageProvider, type LLMProvider, type ResearchProvider } from "@kdone/ai";
import { MockStorageProvider, assetKey, type StorageProvider } from "@kdone/storage";
import {
  assembleManuscript,
  consistencyChecks,
  coverAgent,
  editorialAgent,
  factCheckAgent,
  metadataAgent,
  planningAgent,
  preflightChecks,
  researchAgent,
  structuralChecks,
  writingAgent,
  type AgentContext,
} from "@kdone/agents";
import { buildEpub, validateEpub } from "@kdone/epub";
import { KDPProvider, PUBLISHING_CHECKLIST, type ChecklistItem } from "@kdone/publishing";
import {
  aiDisclosureSchema,
  metadataOutputSchema,
  planOutputSchema,
  researchOutputSchema,
  type MetadataOutput,
  type PlanOutput,
  type ResearchOutput,
} from "@kdone/validation";

/*
 * Domain services. UI components must not make provider calls or mutate book
 * state directly (AGENTS.md / ARCHITECTURE section 3); everything goes through
 * here or through the Orchestrator.
 */

export interface KDoneDeps {
  db: AnyDb;
  queue: Queue;
  llm?: LLMProvider;
  researchProvider?: ResearchProvider;
  imageProvider?: ImageProvider;
  storage?: StorageProvider;
}

const REQUIRED_CHECKLIST: ChecklistItem[] = [...PUBLISHING_CHECKLIST];

export class KDone {
  readonly db: AnyDb;
  readonly queue: Queue;
  readonly llm: LLMProvider;
  readonly researchProvider: ResearchProvider;
  readonly imageProvider: ImageProvider;
  readonly storage: StorageProvider;
  readonly orchestrator: Orchestrator;
  readonly worker: Worker;
  readonly kdp = new KDPProvider();

  constructor(deps: KDoneDeps) {
    this.db = deps.db;
    this.queue = deps.queue;
    const providers = defaultProviders();
    this.llm = deps.llm ?? providers.llm;
    this.researchProvider = deps.researchProvider ?? providers.research;
    this.imageProvider = deps.imageProvider ?? providers.image;
    this.storage = deps.storage ?? new MockStorageProvider();

    this.orchestrator = new Orchestrator({ db: this.db, queue: this.queue });
    this.worker = new Worker({ db: this.db, queue: this.queue });
    this.registerHandlers();
  }

  private ctx(book: { workingTitle: string | null; topic: string | null; targetReader: string | null; toneStyle: string | null; authorName: string | null }, id: string): AgentContext {
    return {
      bookProjectId: id,
      workingTitle: book.workingTitle ?? "Untitled",
      topic: book.topic ?? "",
      targetReader: book.targetReader ?? "readers",
      toneStyle: book.toneStyle ?? "clear",
      authorName: book.authorName ?? "The Author",
    };
  }

  async requireBook(bookId: string, userId: string) {
    const [book] = await this.db.select().from(bookProjects).where(eq(bookProjects.id, bookId));
    if (!book || book.userId !== userId) throw errors.bookNotFound(bookId);
    return book;
  }

  /* ------------------------------------------------------------ Books */

  async createBook(userId: string, input: {
    workingTitle: string; topic: string; targetReader?: string; genre?: string;
    desiredLength?: number; toneStyle?: string; authorName?: string;
  }) {
    const [book] = await this.db
      .insert(bookProjects)
      .values({
        userId,
        workingTitle: input.workingTitle,
        topic: input.topic,
        targetReader: input.targetReader ?? null,
        genre: input.genre ?? null,
        desiredLength: input.desiredLength ?? null,
        toneStyle: input.toneStyle ?? null,
        authorName: input.authorName ?? null,
      })
      .returning();
    if (!book) throw new Error("failed to create book");
    await this.orchestrator.audit({
      userId, bookProjectId: book.id, actorType: "user",
      eventType: "book.created", entityType: "book_project", entityId: book.id,
    });
    return book;
  }

  /* ------------------------------------------------------------ Research */

  async startResearch(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.orchestrator.enqueue({
      userId, bookProjectId: bookId, jobType: "research",
      event: "RESEARCH_START", reason: "research requested",
      input: {},
    });
  }

  async approveResearch(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "RESEARCH_READY") {
      throw errors.precondition("Research is not ready for approval", { status: book.status });
    }
    await this.orchestrator.transition({
      bookProjectId: bookId, event: "PLAN_START", actorType: "user", actorId: userId,
      reason: "research approved",
    });
    const [project] = await this.db
      .select().from(researchProjects)
      .where(eq(researchProjects.bookProjectId, bookId))
      .orderBy(desc(researchProjects.createdAt)).limit(1);
    return { researchProjectId: project?.id ?? null, nextStatus: "PLANNING" };
  }

  async getResearch(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    const [project] = await this.db
      .select().from(researchProjects)
      .where(eq(researchProjects.bookProjectId, bookId))
      .orderBy(desc(researchProjects.createdAt)).limit(1);
    if (!project) return null;
    const [sources, findings] = await Promise.all([
      this.db.select().from(researchSources).where(eq(researchSources.researchProjectId, project.id)),
      this.db.select().from(researchFindings).where(eq(researchFindings.researchProjectId, project.id)),
    ]);
    return { project, sources, findings };
  }

  /* ------------------------------------------------------------ Planning */

  async startPlanning(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "PLANNING") {
      throw errors.precondition("Planning cannot start from this state", { status: book.status });
    }
    return this.orchestrator.enqueue({
      userId, bookProjectId: bookId, jobType: "planning", input: {},
    });
  }

  async approvePlan(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "PLAN_READY") {
      throw errors.precondition("Plan is not ready for approval", { status: book.status });
    }
    await this.orchestrator.transition({
      bookProjectId: bookId, event: "WRITE_START", actorType: "user", actorId: userId,
      reason: "plan approved",
    });
    return { nextStatus: "WRITING" };
  }

  async getPlan(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (!book.currentPlanId) return null;
    const [plan] = await this.db.select().from(bookPlans).where(eq(bookPlans.id, book.currentPlanId));
    if (!plan) return null;
    const rows = await this.db
      .select().from(chapters).where(eq(chapters.bookProjectId, bookId)).orderBy(chapters.ordinal);
    return { plan, chapters: rows };
  }

  /* ------------------------------------------------------------ Writing */

  /** One job per chapter. The book is never generated in a single call. */
  async startWriting(bookId: string, userId: string, chapterOrdinals?: number[]) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "WRITING") {
      throw errors.precondition("Writing cannot start from this state", { status: book.status });
    }
    const rows = await this.db
      .select().from(chapters).where(eq(chapters.bookProjectId, bookId)).orderBy(chapters.ordinal);
    const targets = rows.filter(
      (c) => !chapterOrdinals || chapterOrdinals.includes(c.ordinal),
    );
    if (targets.length === 0) throw errors.precondition("No chapters to generate");

    const jobs: string[] = [];
    for (const chapter of targets) {
      const { jobId } = await this.orchestrator.enqueue({
        userId, bookProjectId: bookId, jobType: "writing",
        input: { chapterOrdinal: chapter.ordinal },
      });
      jobs.push(jobId);
    }
    return { jobIds: jobs };
  }

  async getManuscript(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (!book.currentManuscriptId) return null;
    const [manuscript] = await this.db.select().from(manuscripts).where(eq(manuscripts.id, book.currentManuscriptId));
    return manuscript ?? null;
  }

  /* ------------------------------------------------------------ Editorial / QA */

  async runQa(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "EDITING") {
      throw errors.precondition("QA suite runs while the book is EDITING", { status: book.status });
    }
    return this.orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "qa", input: {} });
  }

  async listIssues(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.db.select().from(qualityIssues).where(eq(qualityIssues.bookProjectId, bookId));
  }

  async updateIssue(issueId: string, userId: string, patch: { status?: string; proposedFix?: string }) {
    const [issue] = await this.db.select().from(qualityIssues).where(eq(qualityIssues.id, issueId));
    if (!issue) throw errors.notFound("Issue", issueId);
    await this.requireBook(issue.bookProjectId, userId);
    const [updated] = await this.db
      .update(qualityIssues)
      .set({
        ...(patch.status ? { status: patch.status as "open" | "accepted" | "rejected" | "resolved" } : {}),
        ...(patch.proposedFix !== undefined ? { proposedFix: patch.proposedFix } : {}),
        updatedAt: new Date(),
      })
      .where(eq(qualityIssues.id, issueId))
      .returning();
    return updated!;
  }

  async openCriticalCount(bookId: string): Promise<number> {
    const rows = await this.db
      .select({ id: qualityIssues.id })
      .from(qualityIssues)
      .where(and(eq(qualityIssues.bookProjectId, bookId), eq(qualityIssues.severity, "critical"), eq(qualityIssues.status, "open")));
    return rows.length;
  }

  /* ------------------------------------------------------------ Production */

  async generateCover(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "cover", input: {} });
  }

  async generateMetadata(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "metadata", input: {} });
  }

  async updateMetadata(bookId: string, userId: string, patch: Partial<MetadataOutput>) {
    const book = await this.requireBook(bookId, userId);
    if (!book.currentMetadataId) throw errors.precondition("No current metadata version to edit");
    const [existing] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.id, book.currentMetadataId));
    if (!existing) throw errors.notFound("Metadata", book.currentMetadataId);

    // A user edit creates a NEW version; it never overwrites the prior one.
    const merged = metadataOutputSchema.parse({
      title: patch.title ?? existing.title,
      subtitle: patch.subtitle ?? existing.subtitle,
      description: patch.description ?? existing.description,
      authorNames: patch.authorNames ?? existing.authorNames,
      keywords: patch.keywords ?? existing.keywords,
      categories: patch.categories ?? existing.categories,
      language: patch.language ?? existing.language,
      rights: patch.rights ?? existing.rights,
      price: patch.price ?? existing.price,
      aiDisclosure: patch.aiDisclosure ?? existing.aiDisclosure,
    });

    const version = (await this.db.select().from(bookMetadata).where(eq(bookMetadata.bookProjectId, bookId))).length + 1;
    const [created] = await this.db
      .insert(bookMetadata)
      .values({ bookProjectId: bookId, version, ...mapMetadata(merged) })
      .returning();

    await this.db.update(bookProjects).set({ currentMetadataId: created!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookId));
    return created!;
  }

  async generateEpub(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.orchestrator.enqueue({ userId, bookProjectId: bookId, jobType: "epub", input: {} });
  }

  async listAssets(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    return this.db.select().from(bookAssets).where(eq(bookAssets.bookProjectId, bookId));
  }

  /* ------------------------------------------------------------ Preflight + approval */

  async previewManifest(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    const [manuscript, metadata, assets, issues] = await Promise.all([
      book.currentManuscriptId
        ? this.db.select().from(manuscripts).where(eq(manuscripts.id, book.currentManuscriptId)).limit(1)
        : Promise.resolve([]),
      book.currentMetadataId
        ? this.db.select().from(bookMetadata).where(eq(bookMetadata.id, book.currentMetadataId)).limit(1)
        : Promise.resolve([]),
      this.db.select().from(bookAssets).where(eq(bookAssets.bookProjectId, bookId)),
      this.db.select().from(qualityIssues).where(eq(qualityIssues.bookProjectId, bookId)),
    ]);

    const cover = assets.find((a) => a.id === book.currentCoverAssetId) ?? null;
    const epub = assets.find((a) => a.id === book.currentEpubAssetId) ?? null;

    return {
      book: { id: book.id, status: book.status, workingTitle: book.workingTitle },
      manuscript: manuscript[0] ?? null,
      metadata: metadata[0] ?? null,
      cover,
      epub,
      issues,
      openCritical: issues.filter((i) => i.severity === "critical" && i.status === "open").length,
    };
  }

  /** Final readiness gate. The only path from QA to READY_FOR_REVIEW (ADR-011). */
  async preflight(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    const [assets, provenance] = await Promise.all([
      this.db.select().from(bookAssets).where(eq(bookAssets.bookProjectId, bookId)),
      this.db.select().from(provenanceRecords),
    ]);

    const currentAssetIds = new Set(
      [book.currentCoverAssetId, book.currentEpubAssetId].filter((v): v is string => Boolean(v)),
    );
    const missingProvenance = assets.filter(
      (a) => currentAssetIds.has(a.id) && !a.provenanceId,
    ).length;

    let disclosurePresent = false;
    let aiGenerated = false;
    if (book.currentMetadataId) {
      const [md] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.id, book.currentMetadataId)).limit(1);
      if (md?.aiDisclosure) {
        disclosurePresent = aiDisclosureSchema.safeParse(md.aiDisclosure).success;
        aiGenerated = md.aiDisclosure === "ai_generated";
      }
    }

    const checks = preflightChecks({
      manuscriptExists: Boolean(book.currentManuscriptId),
      coverExists: Boolean(book.currentCoverAssetId),
      metadataExists: Boolean(book.currentMetadataId),
      epubExists: Boolean(book.currentEpubAssetId),
      openCriticalIssues: await this.openCriticalCount(bookId),
      missingProvenance,
      disclosurePresent,
      aiGenerated,
    });

    const passed = checks.every((c) => c.passed);
    await this.db.insert(preflightRuns).values({ bookProjectId: bookId, passed, checks });

    if (passed && book.status === "QA") {
      await this.orchestrator.transition({
        bookProjectId: bookId, event: "PREFLIGHT_PASSED", actorType: "system", reason: "preflight passed",
      });
    } else if (!passed && book.status === "QA") {
      await this.orchestrator.transition({
        bookProjectId: bookId, event: "PREFLIGHT_NEEDS_REVISION", actorType: "system", reason: "preflight failed",
      }).catch(() => undefined);
    }

    return { passed, checks };
  }

  /** Builds the artifact snapshot an approval binds to (ADR-013). */
  async buildApprovalSnapshot(bookId: string) {
    const book = await this.loadBook(bookId);
    if (!book) throw errors.bookNotFound(bookId);
    if (!book.currentManuscriptId) throw errors.precondition("No current manuscript");
    if (!book.currentMetadataId) throw errors.precondition("No current metadata");
    if (!book.currentCoverAssetId) throw errors.precondition("No current cover");
    if (!book.currentEpubAssetId) throw errors.precondition("No current EPUB");

    const [manuscript, metadata, cover, epub] = await Promise.all([
      this.db.select().from(manuscripts).where(eq(manuscripts.id, book.currentManuscriptId!)).limit(1),
      this.db.select().from(bookMetadata).where(eq(bookMetadata.id, book.currentMetadataId!)).limit(1),
      this.db.select().from(bookAssets).where(eq(bookAssets.id, book.currentCoverAssetId!)).limit(1),
      this.db.select().from(bookAssets).where(eq(bookAssets.id, book.currentEpubAssetId!)).limit(1),
    ]);

    const provenanceIds = new Set<string>();
    for (const asset of [cover[0], epub[0]]) {
      if (asset?.provenanceId) provenanceIds.add(asset.provenanceId);
    }

    const provenanceRows = await this.db
      .select()
      .from(provenanceRecords)
      .where(
        provenanceIds.size > 0
          ? inArray(provenanceRecords.id, [...provenanceIds])
          : sql`false`,
      );

    const provenance = provenanceRows.map((p) => ({
      provenanceId: p.id,
      method: p.method,
      provider: p.provider,
      model: p.model,
    }));

    const fingerprint = provenanceFingerprint({
      manuscriptId: book.currentManuscriptId,
      metadataId: book.currentMetadataId,
      coverAssetId: book.currentCoverAssetId,
      epubAssetId: book.currentEpubAssetId,
      provenance,
    });

    return {
      manuscriptId: book.currentManuscriptId,
      metadataId: book.currentMetadataId,
      coverAssetId: book.currentCoverAssetId,
      epubAssetId: book.currentEpubAssetId,
      provenanceFingerprint: fingerprint,
      provenanceCount: provenance.length,
      metadata: metadata[0] ?? null,
      cover: cover[0] ?? null,
      epub: epub[0] ?? null,
      manuscriptRow: manuscript[0] ?? null,
    };
  }

  async approve(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "READY_FOR_REVIEW") {
      throw errors.precondition("Book must be READY_FOR_REVIEW to approve", { status: book.status });
    }
    const openCritical = await this.openCriticalCount(bookId);
    if (openCritical > 0) throw errors.criticalIssuesOpen(openCritical);

    const snapshot = await this.buildApprovalSnapshot(bookId);

    const [approval] = await this.db
      .insert(approvalEvents)
      .values({
        bookProjectId: bookId,
        manuscriptId: snapshot.manuscriptId,
        metadataId: snapshot.metadataId,
        coverAssetId: snapshot.coverAssetId,
        epubAssetId: snapshot.epubAssetId,
        provenanceFingerprint: snapshot.provenanceFingerprint,
        approvedBy: userId,
      })
      .returning();

    await this.orchestrator.transition({
      bookProjectId: bookId, event: "APPROVE", actorType: "user", actorId: userId,
      reason: "human approval",
    });

    await this.orchestrator.audit({
      userId, bookProjectId: bookId, actorType: "user",
      eventType: "book.approved", entityType: "approval_event", entityId: approval!.id,
      metadata: { manuscriptId: snapshot.manuscriptId },
    });

    return approval!;
  }

  async latestApproval(bookId: string) {
    const [approval] = await this.db
      .select().from(approvalEvents)
      .where(eq(approvalEvents.bookProjectId, bookId))
      .orderBy(desc(approvalEvents.approvedAt)).limit(1);
    return approval ?? null;
  }

  /* ------------------------------------------------------------ Publishing */

  /**
   * Mode A (prepare). Refuses when the current artifact set has drifted from
   * the approval snapshot (ADR-013). In prepare-only mode the book stays in
   * USER_APPROVED, which is terminal (ADR-012).
   */
  async publishStart(bookId: string, userId: string, checklistConfirmed: string[] = []) {
    const book = await this.requireBook(bookId, userId);
    if (book.status !== "USER_APPROVED") {
      throw errors.precondition("Book must be USER_APPROVED to start publishing", { status: book.status });
    }

    const approval = await this.latestApproval(bookId);
    if (!approval) throw errors.approvalRequired("No approval event exists for this book");

    const snapshot = await this.buildApprovalSnapshot(bookId);
    const changed: string[] = [];
    if (approval.manuscriptId !== snapshot.manuscriptId) changed.push("manuscriptId");
    if (approval.metadataId !== snapshot.metadataId) changed.push("metadataId");
    if (approval.coverAssetId !== snapshot.coverAssetId) changed.push("coverAssetId");
    if (approval.epubAssetId !== snapshot.epubAssetId) changed.push("epubAssetId");
    if (approval.provenanceFingerprint !== snapshot.provenanceFingerprint) changed.push("provenanceFingerprint");
    if (changed.length > 0) throw errors.artifactDrift(changed);

    const missing = REQUIRED_CHECKLIST.filter((item) => !checklistConfirmed.includes(item));
    if (missing.length > 0) {
      throw errors.precondition("Publishing checklist is incomplete", { missing });
    }

    const md = metadataOutputSchema.parse({
      title: snapshot.metadata!.title,
      subtitle: snapshot.metadata!.subtitle ?? "",
      description: snapshot.metadata!.description ?? "",
      authorNames: snapshot.metadata!.authorNames ?? [],
      keywords: snapshot.metadata!.keywords ?? [],
      categories: snapshot.metadata!.categories ?? [],
      language: snapshot.metadata!.language ?? "en",
      rights: snapshot.metadata!.rights ?? "",
      price: snapshot.metadata!.price ?? "0.00",
      aiDisclosure: aiDisclosureSchema.parse(snapshot.metadata!.aiDisclosure),
    });

    const result = await this.kdp.prepare({
      title: book.workingTitle ?? md.title,
      subtitle: md.subtitle,
      metadata: md,
      artifacts: {
        manuscriptId: approval.manuscriptId,
        metadataId: approval.metadataId,
        coverAssetId: approval.coverAssetId,
        epubAssetId: approval.epubAssetId,
        approvalId: approval.id,
      },
      checklistConfirmed,
    });

    const validation = this.kdp.validate(result.package);
    if (!validation.valid) {
      throw errors.precondition("Prepared package failed validation", { errors: validation.errors });
    }

    const [publishingJob] = await this.db
      .insert(publishingJobs)
      .values({
        bookProjectId: bookId,
        provider: this.kdp.name,
        mode: "prepare",
        status: "PREPARED",
        packageStorageKey: `books/${bookId}/kdp/package.json`,
      })
      .returning();

    await this.storage.put(
      `books/${bookId}/kdp/package.json`,
      result.package,
      "text/plain; charset=utf-8",
    );

    await this.db.insert(publishingEvents).values({
      publishingJobId: publishingJob!.id,
      eventType: "package.prepared",
      details: { requiresDisclosure: result.manifest.disclosure.requiresDisclosure },
    });

    await this.orchestrator.audit({
      userId, bookProjectId: bookId, actorType: "user",
      eventType: "publishing.prepared", entityType: "publishing_job", entityId: publishingJob!.id,
      metadata: { mode: "prepare", approvalId: approval.id },
    });

    // ADR-012: prepare-only leaves the book in USER_APPROVED.
    return {
      publishingJobId: publishingJob!.id,
      mode: "prepare" as const,
      bookStatus: book.status,
      manifest: result.manifest,
      fieldMapping: result.fieldMapping,
    };
  }

  async publishStatus(bookId: string, userId: string) {
    const book = await this.requireBook(bookId, userId);
    const [job] = await this.db
      .select().from(publishingJobs)
      .where(eq(publishingJobs.bookProjectId, bookId))
      .orderBy(desc(publishingJobs.createdAt)).limit(1);
    const events = job
      ? await this.db.select().from(publishingEvents).where(eq(publishingEvents.publishingJobId, job.id))
      : [];
    return { bookStatus: book.status, job: job ?? null, events };
  }

  async listJobs(bookId: string, userId: string) {
    await this.requireBook(bookId, userId);
    const rows = await this.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.bookProjectId, bookId))
      .orderBy(desc(generationJobs.queuedAt));

    return rows.map((job) => ({
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      progress: job.progress,
      message: job.errorMessage,
      attempts: job.attempts,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    }));
  }

  /**
   * Publishing settings for a user. `aiDisclosure` is a default preference and
   * never drives publishing behaviour (ADR-014).
   */
  async getPublishingSettings(userId: string) {
    const rows = await this.db
      .select()
      .from(bookSettings)
      .where(eq(bookSettings.userId, userId))
      .limit(1);
    const existing = rows[0];
    if (existing) return existing;

    const [created] = await this.db
      .insert(bookSettings)
      .values({ userId, language: "en", primaryMarketplace: "US" })
      .returning();
    return created!;
  }

  /* ------------------------------------------------------------ Job handlers */

  private registerHandlers(): void {

    this.worker.handle("research", async (job) => {
      const bookId = job.id && (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const research = await researchAgent(this.researchProvider, this.llm, ctx);
      await this.persistResearch(bookId, book!.userId, research.output);
      return {
        agentType: "research",
        usage: research.usage,
        output: { sources: research.output.sources.length, findings: research.output.findings.length },
        event: "RESEARCH_COMPLETE",
      };
    });

    this.worker.handle("planning", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const research = await this.loadResearchOutput(bookId);
      const plan = await planningAgent(this.llm, ctx, research, book!.desiredLength ?? 30_000);
      await this.persistPlan(bookId, book!.userId, plan.output);
      return {
        agentType: "planning",
        usage: plan.usage,
        output: { chapters: plan.output.chapters.length },
        event: "PLAN_COMPLETE",
      };
    });

    this.worker.handle("writing", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const ordinal = Number((job.payload as { chapterOrdinal?: number }).chapterOrdinal ?? 1);
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const [chapter] = await this.db
        .select().from(chapters)
        .where(and(eq(chapters.bookProjectId, bookId), eq(chapters.ordinal, ordinal))).limit(1);
      if (!chapter) throw new Error(`chapter ${ordinal} not found`);

      const research = await this.loadResearchOutput(bookId);
      const priors = await this.loadPriorSummaries(bookId, ordinal);
      const result = await writingAgent(
        this.llm, ctx,
        { ordinal, title: chapter.title ?? `Chapter ${ordinal}`, objective: chapter.objective ?? "" },
        research, priors,
      );

      await this.persistDraft(chapter.id, bookId, book!.userId, result.output.title, result.output.content, result.generated);
      await this.assembleIfComplete(bookId);

      const isLast = ordinal >= (await this.chapterCount(bookId));
      return {
        agentType: "writing",
        usage: result.usage,
        output: { ordinal, title: result.output.title },
        event: isLast ? "EDITING_START" : undefined,
      };
    });

    this.worker.handle("qa", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const research = await this.loadResearchOutput(bookId);
      const chapterRows = await this.loadDraftChapters(bookId);

      const structural = structuralChecks(chapterRows, await this.chapterCount(bookId));
      const editorial = await editorialAgent(this.llm, ctx, chapterRows);
      const factCheck = await factCheckAgent(this.llm, ctx, chapterRows, research.sources.length);
      const unsupported = factCheck.output.claims.filter((c) => c.result === "unsupported").length;
      const consistency = consistencyChecks(chapterRows, unsupported);

      const issues = [...structural, ...editorial.output.issues, ...consistency];

      await this.db.delete(qualityIssues).where(eq(qualityIssues.bookProjectId, bookId));
      for (const issue of issues) {
        await this.db.insert(qualityIssues).values({
          bookProjectId: bookId,
          severity: issue.severity,
          issueType: issue.issueType,
          message: issue.message,
          location: issue.location,
          proposedFix: issue.proposedFix,
          status: "open",
        });
      }

      const byOrdinal = new Map(chapterRows.map((c) => [c.ordinal, c.chapterId]));
      for (const claim of factCheck.output.claims) {
        await this.db.insert(factChecks).values({
          bookProjectId: bookId,
          chapterId: claim.chapterOrdinal ? byOrdinal.get(claim.chapterOrdinal) ?? null : null,
          claim: claim.claim,
          result: claim.result,
          rationale: claim.rationale,
        });
      }

      await this.db.insert(editorialReviews).values({
        bookProjectId: bookId, reviewType: "editorial", status: "COMPLETE",
        summary: `${issues.length} issue(s) recorded`,
      });

      return {
        agentType: "editorial",
        usage: factCheck.usage,
        output: { issues: issues.length, critical: issues.filter((i) => i.severity === "critical").length },
      };
    });

    this.worker.handle("cover", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const plan = await this.loadPlanOutput(bookId);
      const result = await coverAgent(this.imageProvider, this.llm, ctx, plan);
      const asset = await this.storeAsset(bookId, book!.userId, "cover", "svg", result.output.svg, "image/svg+xml", result.generated, result.usage.provider, result.usage.model);
      return { agentType: "cover", usage: result.usage, output: { assetId: asset.id } };
    });

    this.worker.handle("metadata", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const ctx = this.ctx(book!, bookId);
      const plan = await this.loadPlanOutput(bookId);
      const result = await metadataAgent(this.llm, ctx, plan, await this.collectDisclosures(bookId));
      const version = (await this.db.select().from(bookMetadata).where(eq(bookMetadata.bookProjectId, bookId))).length + 1;
      const [row] = await this.db
        .insert(bookMetadata)
        .values({ bookProjectId: bookId, version, ...mapMetadata(result.output) })
        .returning();
      await this.db.update(bookProjects).set({ currentMetadataId: row!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookId));
      return { agentType: "metadata", usage: result.usage, output: { metadataId: row!.id, aiDisclosure: result.output.aiDisclosure } };
    });

    this.worker.handle("epub", async (job) => {
      const bookId = (await this.bookIdForJob(job.id))!;
      const book = await this.loadBook(bookId);
      const bookIdUnsafe = bookId;
      if (!book!.currentManuscriptId) throw new Error("no current manuscript");
      const [manuscript] = await this.db.select().from(manuscripts).where(eq(manuscripts.id, book!.currentManuscriptId!)).limit(1);
      if (!book!.currentMetadataId) throw new Error("no current metadata");
      const [mdRow] = await this.db.select().from(bookMetadata).where(eq(bookMetadata.id, book!.currentMetadataId!)).limit(1);

      const md = metadataOutputSchema.parse({
        title: mdRow!.title, subtitle: mdRow!.subtitle ?? "", description: mdRow!.description ?? "",
        authorNames: mdRow!.authorNames ?? [], keywords: mdRow!.keywords ?? [], categories: mdRow!.categories ?? [],
        language: mdRow!.language ?? "en", rights: mdRow!.rights ?? "", price: mdRow!.price ?? "0.00",
        aiDisclosure: aiDisclosureSchema.parse(mdRow!.aiDisclosure ?? "ai_generated"),
      });

      const bytes = buildEpub({ manuscript: manuscript!.assembledContent as never, metadata: md });
      const validation = validateEpub(bytes);
      if (!validation.valid) {
        throw new Error(`EPUB validation failed: ${validation.errors.join("; ")}`);
      }

      const asset = await this.storeAsset(bookIdUnsafe, book!.userId, "epub", "epub", bytes, "application/epub+zip", true, "deterministic", "epub-builder");
      await this.db.update(bookProjects).set({ currentEpubAssetId: asset.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookId));

      return { agentType: "production", usage: { provider: "deterministic", model: "epub-builder", inputUnits: 0, outputUnits: bytes.byteLength, estimatedCost: 0 }, output: { assetId: asset.id, sizeBytes: bytes.byteLength, entries: validation.entryCount } };
    });
  }

  /* ------------------------------------------------------------ Helpers */

  /**
   * Loads a book row with an explicit select.
   *
   * The Drizzle relational query API (`db.query.*`) requires `relations()`
   * definitions and stalls against PGlite without them, so all lookups use the
   * explicit select form.
   */
  private async loadBook(bookId: string) {
    const rows = await this.db
      .select()
      .from(bookProjects)
      .where(eq(bookProjects.id, bookId))
      .limit(1);
    return rows[0];
  }

  private async bookIdForJob(jobId: string): Promise<string | null> {
    const [job] = await this.db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    return job?.bookProjectId ?? null;
  }

  private async chapterCount(bookId: string): Promise<number> {
    const rows = await this.db.select({ id: chapters.id }).from(chapters).where(eq(chapters.bookProjectId, bookId));
    return rows.length;
  }

  private async loadResearchOutput(bookId: string): Promise<ResearchOutput> {
    const stored = await this.db
      .select({ id: researchProjects.id, marketSummary: researchProjects.marketSummary, readerProblemSummary: researchProjects.readerProblemSummary })
      .from(researchProjects)
      .where(eq(researchProjects.bookProjectId, bookId))
      .orderBy(desc(researchProjects.createdAt)).limit(1);
    const project = stored[0];
    if (!project?.marketSummary) {
      throw errors.precondition("Research has not been generated yet");
    }
    const sources = await this.db
      .select().from(researchSources)
      .where(eq(researchSources.researchProjectId, project.id!));
    const findings = await this.db
      .select().from(researchFindings)
      .where(eq(researchFindings.researchProjectId, project.id!));

    return researchOutputSchema.parse({
      marketSummary: project.marketSummary,
      readerProblemSummary: project.readerProblemSummary ?? "",
      sources: sources.map((s) => ({ url: s.url ?? "", title: s.title ?? "Untitled", sourceName: s.sourceName ?? "Unknown", sourceType: s.sourceType ?? "unknown", status: s.status ?? "retained" })),
      findings: findings.map((f) => ({ findingType: f.findingType ?? "note", statement: f.statement, confidence: (f.confidence as "low" | "medium" | "high") ?? "medium", sourceIndex: null })),
      angles: [],
    });
  }

  private async loadPlanOutput(bookId: string): Promise<PlanOutput> {
    const book = await this.loadBook(bookId);
    if (!book?.currentPlanId) throw errors.precondition("No approved plan");
    const [plan] = await this.db.select().from(bookPlans).where(eq(bookPlans.id, book.currentPlanId)).limit(1);
    if (!plan) throw errors.precondition("No approved plan");
    const rows = await this.db.select().from(chapters).where(eq(chapters.bookProjectId, bookId)).orderBy(chapters.ordinal);
    return planOutputSchema.parse({
      title: plan.title ?? "Untitled",
      subtitle: plan.subtitle ?? "",
      positioning: plan.positioning ?? "",
      bookPromise: plan.bookPromise ?? "",
      targetWordCount: plan.targetWordCount ?? 30000,
      chapters: rows.map((c) => ({ ordinal: c.ordinal, title: c.title ?? `Chapter ${c.ordinal}`, objective: c.objective ?? "", targetWordCount: c.targetWordCount ?? 3000 })),
    });
  }

  private async persistResearch(bookId: string, userId: string, output: ResearchOutput) {
    const [project] = await this.db
      .insert(researchProjects)
      .values({
        bookProjectId: bookId, status: "COMPLETE",
        researchBrief: output.marketSummary,
        marketSummary: output.marketSummary,
        readerProblemSummary: output.readerProblemSummary,
        completedAt: new Date(),
      })
      .returning();

    const sourceRows = await this.db
      .insert(researchSources)
      .values(
        output.sources.map((source) => ({
          researchProjectId: project!.id,
          url: source.url,
          title: source.title,
          sourceName: source.sourceName,
          sourceType: source.sourceType,
          status: source.status,
        })),
      )
      .returning();
    const sourceIds = sourceRows.map((row) => row.id);

    if (output.findings.length > 0) {
      await this.db.insert(researchFindings).values(
        output.findings.map((finding) => ({
          researchProjectId: project!.id,
          sourceId:
            finding.sourceIndex === null ? null : sourceIds[finding.sourceIndex] ?? null,
          findingType: finding.findingType,
          statement: finding.statement,
          confidence: finding.confidence,
        })),
      );
    }
    await this.db.update(bookProjects).set({ currentResearchProjectId: project!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookId));
    void userId;
  }

  private async persistPlan(bookId: string, userId: string, plan: PlanOutput) {
    const version = (await this.db.select().from(bookPlans).where(eq(bookPlans.bookProjectId, bookId))).length + 1;
    const [row] = await this.db
      .insert(bookPlans)
      .values({
        bookProjectId: bookId, version,
        title: plan.title, subtitle: plan.subtitle, positioning: plan.positioning,
        bookPromise: plan.bookPromise, targetWordCount: plan.targetWordCount,
        status: "GENERATED", outline: plan.chapters,
      })
      .returning();

    for (const chapter of plan.chapters) {
      await this.db
        .insert(chapters)
        .values({
          bookProjectId: bookId, ordinal: chapter.ordinal, title: chapter.title,
          objective: chapter.objective, targetWordCount: chapter.targetWordCount,
        })
        .onConflictDoNothing();
    }

    await this.db.update(bookProjects).set({ currentPlanId: row!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookId));
    void userId;
  }

  private async persistDraft(
    chapterId: string, bookProjectId: string, userId: string,
    title: string, content: string, generated: boolean,
  ) {
    // Append a new version. Existing drafts are never overwritten.
    const version = (await this.db.select().from(chapterDrafts).where(eq(chapterDrafts.chapterId, chapterId))).length + 1;
    const provenance = generated
      ? (await this.db.insert(provenanceRecords).values({ method: "ai_generated", provider: "mock", model: "mock-1" }).returning())[0]
      : null;

    const [draft] = await this.db
      .insert(chapterDrafts)
      .values({
        chapterId, version, content,
        generationSource: generated ? "ai_generated" : "user_created",
        provenanceId: provenance?.id ?? null,
      })
      .returning();

    await this.db.update(chapters).set({ currentDraftId: draft!.id, title, updatedAt: new Date() }).where(eq(chapters.id, chapterId));
    void userId; void bookProjectId;
  }

  private async loadPriorSummaries(bookProjectId: string, beforeOrdinal: number) {
    const rows = await this.db
      .select({ ordinal: chapters.ordinal, content: chapterDrafts.content, draftId: chapterDrafts.id })
      .from(chapters)
      .innerJoin(chapterDrafts, eq(chapters.currentDraftId, chapterDrafts.id))
      .where(and(eq(chapters.bookProjectId, bookProjectId), sql`${chapters.ordinal} < ${beforeOrdinal}`))
      .orderBy(chapters.ordinal);
    return rows.map((r) => ({ ordinal: r.ordinal, summary: r.content.slice(0, 200) }));
  }

  private async loadDraftChapters(bookProjectId: string) {
    const rows = await this.db
      .select({ ordinal: chapters.ordinal, title: chapters.title, content: chapterDrafts.content, chapterId: chapters.id })
      .from(chapters)
      .innerJoin(chapterDrafts, eq(chapters.currentDraftId, chapterDrafts.id))
      .where(eq(chapters.bookProjectId, bookProjectId))
      .orderBy(chapters.ordinal);
    return rows.map((r) => ({ ordinal: r.ordinal, title: r.title ?? `Chapter ${r.ordinal}`, content: r.content, chapterId: r.chapterId }));
  }

  /** Assembles a NEW immutable manuscript version from current drafts. */
  private async assembleIfComplete(bookProjectId: string) {
    const rows = await this.db
      .select({ ordinal: chapters.ordinal, title: chapters.title, content: chapterDrafts.content, draftId: chapterDrafts.id, version: chapterDrafts.version })
      .from(chapters)
      .innerJoin(chapterDrafts, eq(chapters.currentDraftId, chapterDrafts.id))
      .where(eq(chapters.bookProjectId, bookProjectId))
      .orderBy(chapters.ordinal);

    const expected = await this.chapterCount(bookProjectId);
    if (rows.length < expected) return null;

    const book = await this.loadBook(bookProjectId);
    const version = (await this.db.select().from(manuscripts).where(eq(manuscripts.bookProjectId, bookProjectId))).length + 1;

    const assembled = assembleManuscript({
      title: book?.workingTitle ?? "Untitled",
      version,
      chapters: rows.map((r) => ({ ordinal: r.ordinal, title: r.title ?? `Chapter ${r.ordinal}`, content: r.content, sourceDraftId: r.draftId, sourceDraftVersion: r.version })),
    });

    const [row] = await this.db
      .insert(manuscripts)
      .values({ bookProjectId, version, assembledContent: assembled, wordCount: assembled.wordCount, status: "ASSEMBLED" })
      .returning();

    await this.db.update(bookProjects).set({ currentManuscriptId: row!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookProjectId));
    return row!;
  }

  private async collectDisclosures(bookProjectId: string): Promise<string[]> {
    const drafts = await this.db
      .select({ provenanceId: chapterDrafts.provenanceId })
      .from(chapters)
      .innerJoin(chapterDrafts, eq(chapters.currentDraftId, chapterDrafts.id))
      .where(eq(chapters.bookProjectId, bookProjectId));
    const methods: string[] = [];
    if (drafts.some((d) => d.provenanceId)) methods.push("ai_generated");
    return methods.length > 0 ? methods : ["user_created"];
  }

  private async storeAsset(
    bookProjectId: string, userId: string, assetType: "cover" | "epub",
    extension: string, body: Uint8Array | string, mimeType: string,
    generated: boolean, provider: string, model: string,
  ) {
    const version = (await this.db.select().from(bookAssets).where(and(eq(bookAssets.bookProjectId, bookProjectId), eq(bookAssets.assetType, assetType)))).length + 1;
    const key = assetKey({ bookProjectId, assetType, version, extension });

    const { sizeBytes } = await this.storage.put(key, body, mimeType);

    const provenance = generated
      ? (await this.db.insert(provenanceRecords).values({ method: "ai_generated", provider, model }).returning())[0]
      : null;

    const [asset] = await this.db
      .insert(bookAssets)
      .values({
        bookProjectId, assetType, storageKey: key, mimeType,
        sizeBytes, version, provenanceId: provenance?.id ?? null,
      })
      .returning();

    const pointerField = assetType === "cover" ? "currentCoverAssetId" : "currentEpubAssetId";
    await this.db.update(bookProjects).set({ [pointerField]: asset!.id, updatedAt: new Date() }).where(eq(bookProjects.id, bookProjectId));
    void userId;
    return asset!;
  }

  /** Runs every currently queued job for a book and waits for completion. */
  async runQueuedJobs(): Promise<void> {
    const jobs = await this.db.select().from(generationJobs).where(eq(generationJobs.status, "QUEUED"));
    for (const job of jobs as GenerationJob[]) {
      await this.worker.runOnce(job.id);
    }
  }
}

function mapMetadata(md: MetadataOutput) {
  return {
    title: md.title,
    subtitle: md.subtitle,
    description: md.description,
    authorNames: md.authorNames,
    keywords: md.keywords,
    categories: md.categories,
    language: md.language,
    rights: md.rights,
    price: md.price,
    aiDisclosure: md.aiDisclosure,
  };
}

export type { BookEvent, JobType };
