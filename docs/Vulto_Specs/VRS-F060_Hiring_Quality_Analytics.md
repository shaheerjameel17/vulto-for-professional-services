---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F060
---

# VRS-F060 — Hiring Quality Analytics

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate, its source, structured rejection reasons and the `converted_from` edge), [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] (FeedbackEntry, interview ratings), [[VRS-F039_Performance_Review_Cycle|VRS-F039]] (ReviewEntry ratings), [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] (the requisition a hire originated from), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (**the unified disclosure control, replacing this feature's former private threshold**)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Why this is a statistics feature, not a Standing Rule 7 feature

This correlates structured records across features — an interview rating and a later performance rating for the same person — and that is worth checking against Standing Rule 7 before building.

**The distinction holds.** [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s exclusive territory is combining already-interpreted *alerts* into new composite meaning. A feedback entry and a review entry are not alerts; they are structured facts — a rating someone gave, a review someone wrote — and one well-defined correlation across them is the same category of computation [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] performs over a single source.

**This reasons about a correlation, not a compounding concern.**

---

## What It Is

A closed-loop analysis connecting the hiring pipeline to what actually happened afterward: whether interview ratings predict later performance, which sources produce better outcomes, whether specific panelists' judgment tracks with reality, and — new in this revision — **how the pipeline itself performs**.

---

## Problem It Solves

Most agencies never learn whether their hiring process works. A candidate scores well, gets hired, and six months later either thrives or struggles, with nobody connecting the outcome back to the process.

Over enough hires that connection is an answerable statistical question rather than a leadership impression, and answering it honestly can change what the interview process actually weighs.

**The additions in this revision close the other half of the loop.** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] now records structured rejection reasons, time in stage and source, and [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] records what a requisition was raised for. That data was accumulated specifically so this feature could ask whether the pipeline is working, not only whether the hires were good.

---

## User-Facing Flows

### Interview rating against performance

Hires grouped by interview rating range, alongside the average performance rating those same people received — revealing whether the interview's own signal predicts anything.

### Source quality

Average subsequent performance by source — direct, referral, careers site, talent pool — wherever enough hires exist to report responsibly.

**Referral quality is frequently the most consequential figure here**, because it is the one that justifies or refutes a referral bonus program.

### Panelist calibration

Whether a panelist's ratings, averaged across every candidate they assessed who was hired, track with those hires' actual performance. **This evaluates a specific person's judgment**, which is why it sits at the narrowest visibility in the feature.

### Pipeline performance

New. Time to hire by stage, offer acceptance rate, and the distribution of structured rejection reasons — which together answer whether the process itself is working, separately from whether its outputs were good.

A pipeline losing candidates at offer stage has a compensation problem. One losing them at screening has a sourcing problem. **Both look identical in a time-to-hire figure alone.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Hiring quality | Content | Four analyzes |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

**Interview against performance** is a bar chart, one bar per rating bucket, with sample size stated on each. A bucket below threshold is absent rather than shown small.

**Source quality** is a Table: source, hire count, average performance, and — usefully — **average time in pipeline**. A source producing good hires slowly and one producing them quickly are different propositions.

**Panelist calibration** is a Table: panelist, average rating given, actual average outcome, sample size, and the difference. Sorted by absolute difference descending.

**The framing is deliberately neutral.** The column reads *difference*, not *accuracy*, and a panelist who rates consistently high is described as such rather than as wrong. Someone rating everyone highly may be assessing a genuinely strong candidate pool, and a screen implying otherwise turns a calibration tool into a performance review nobody agreed to.

**Pipeline performance** is three compact blocks: median working days per stage as a horizontal bar, offer acceptance as a Stat, and rejection reasons as a stacked bar by structured reason.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and HR Admin. Panelist calibration is never shown to a Manager, including a Manager who is themselves a panelist |
| Suppressed | Below threshold, a bucket, source or panelist is omitted entirely rather than shown small |
| Empty | *Not enough hiring history yet.* with the hire count so far |
| Error | Not applicable |

### Responsive

Sections stack below 1280px. The panelist table drops `average rating given`, keeping the difference.

---

## Technical Architecture

### No new node type

Every figure traces existing relationships: a hire from their Candidate record via `converted_from`, to their Employee record, to their review history, and via the interview process's own feedback records.

### The four analyzes

**Interview to performance.** For each hire with at least one finalized review, their interview rating averaged across feedback entries is paired with their first review's rating. Bucketed, shown only above threshold.

**Source quality.** Hires grouped by source; average subsequent performance and average pipeline duration per source, shown only above threshold.

**Panelist calibration.** For each employee who has served as a panelist, their average rating given across every candidate they assessed who was later hired, against those hires' actual average performance. Above threshold, Owner and HR Admin only.

**Pipeline performance.** Median working days per stage per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], offer acceptance rate from [[VRS-F032_Offer_Management|VRS-F032]], and rejection reason distribution from [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s structured enum.

Working days rather than calendar days matters here specifically: a pipeline that looks slow may simply span a holiday period, and a firm comparing its time-to-hire across quarters would otherwise see seasonal noise it cannot explain.

### Disclosure control

Every breakdown passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s mechanism. **This feature previously carried its own threshold key.**

The unified mechanism matters more here than almost anywhere else in the product: a source breakdown and a panelist breakdown over the same small hire set can be differenced against each other, and a private per-feature threshold would have caught neither.

### API contracts

```
hiringQuality.getInterviewToPerformance(workspaceId) -> {
  buckets: { interviewRatingRange, averagePerformanceRating, sampleSize }[]
} | Suppressed

hiringQuality.getSourceQuality(workspaceId) -> {
  bySource: { source, hireCount, averagePerformanceRating,
              averagePipelineWorkingDays }[]
}
  // A source below threshold is omitted entirely

hiringQuality.getPanelistCalibration(workspaceId) -> {
  byPanelist: { employeeId, employeeName, averageRatingGiven,
                actualAverageOutcome, difference, sampleSize }[]
}
  // Owner and HR Admin only

hiringQuality.getPipelinePerformance(workspaceId, periodMonths?) -> {
  medianWorkingDaysByStage: { stage, medianDays, sampleSize }[],
  offerAcceptanceRate: { accepted, declined, rate },
  rejectionReasons: { reason, count }[]
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type or edge type. Every figure traces existing relationships |
| G02 | Every breakdown passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control before any average is computed |
| G03 | Panelist calibration is Owner and HR Admin only. A permission decision made because the analysis evaluates a specific employee's judgment, not because the data is more protected than the other analyzes |
| G04 | This feature reasons about correlations between structured records, never combining already-interpreted alerts. It remains outside Standing Rule 7 |
| G05 | Pipeline duration figures count working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G06 | Rejection reason distribution reads [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s structured enum only. Free-text detail is never analyzed |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F060-S01 | Interview-to-performance correlation | Logic |
| VRS-F060-S02 | Source quality | Logic |
| VRS-F060-S03 | Panelist calibration | Logic |
| VRS-F060-S04 | Pipeline performance | Logic |

---

## Feature Acceptance Criteria

**GIVEN** 6 hires with interview ratings in the same bucket and finalized reviews, against a threshold of 5
**WHEN** the correlation is requested
**THEN** that bucket's average performance and sample size are returned

---

**GIVEN** only 2 hires came from a specific source
**WHEN** source quality is requested
**THEN** that source is omitted entirely, not shown with a two-person average

---

**GIVEN** a panelist assessed 7 candidates who were later hired
**WHEN** an HR Admin requests calibration
**THEN** their average rating given, the actual outcome and the difference are shown

---

**GIVEN** a Manager requests panelist calibration
**WHEN** the request is made
**THEN** it is refused, regardless of whether they are themselves one of the panelists

---

**GIVEN** a pipeline stage spans a two-week holiday period
**WHEN** median time in stage is computed
**THEN** it counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], not calendar days

---

**GIVEN** thirty candidates were rejected with structured reasons
**WHEN** the distribution is computed
**THEN** it reads the structured enum only, and no free-text detail is analyzed

---

**GIVEN** a code review checks whether this feature combines any interpreted alert with another
**WHEN** the check runs
**THEN** no such combination exists. Every input is a structured factual record

---

## Non-Functional Requirements

- All four analyzes resolve within 1 second for up to 500 historical hires
- Full functionality offline

---

## Security Considerations

- **Panelist calibration is the one analysis evaluating a specific employee** rather than a process or an outcome in the abstract, and its narrower visibility reflects that directly. The other three are workspace-level process quality; this one is kept narrow for a different reason, stated rather than left looking like an inconsistency.
- **The unified disclosure control matters more here than elsewhere.** A source breakdown and a panelist breakdown over the same small hire set are differenceable against each other, and the private per-feature threshold this feature previously carried would have caught neither.
- **Rejection reasons are analyzed as a structured enum only.** The free-text detail a recruiter wrote is a private assessment of a specific person and is never aggregated, never charted, and never read by this feature.
- **A calibration table is a record of colleagues' judgment quality.** It is genuinely useful and it is also the sort of artifact that changes behavior once people know it exists — panelists who know they are scored will score differently. The neutral framing is a partial mitigation and not a complete one, and a firm using this should tell its panelists it exists rather than let them discover it.

---

## Out of Scope

- **Any recommendation to change interview weighting or hiring criteria** — this reports a correlation. Deciding what to do is a human judgment
- **Individual candidate predictions** — historical correlation across many hires, never a forward-looking claim about one person
- **Analysing free-text rejection detail or interview notes** — the structured enum and ratings only
- **Cost per hire** — a financial figure requiring recruitment spend this product does not track

---

## Decisions Recorded

**The private threshold is replaced by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s mechanism**, which adds the differencing protection this feature specifically needs given how many overlapping breakdowns it produces over the same small population.

**Pipeline performance is added as a fourth analysis.** [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s structured rejection reasons, time in stage and source data were accumulated specifically so this question could be asked, and the previous specification analyzed only the hires rather than the process. A pipeline losing candidates at offer has a compensation problem; one losing them at screening has a sourcing problem, and a time-to-hire figure alone shows neither.

**Source quality reports average pipeline duration alongside performance.** A source producing good hires slowly and one producing them quickly are different propositions, and the referral figure in particular is what justifies or refutes [[VRS-F034_Employee_Referral_Program|VRS-F034]]'s bonus program.

**Panelist calibration is framed as *difference*, not *accuracy*.** Someone rating everyone highly may be assessing a genuinely strong pool, and a column headed accuracy turns a calibration tool into a performance review nobody agreed to.

**Pipeline duration counts working days.** A firm comparing time-to-hire across quarters would otherwise see seasonal noise it cannot explain.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the structured pipeline data this feature was waiting for
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — the feedback entries correlated here
- [[VRS-F034_Employee_Referral_Program|VRS-F034]] — the referral program source quality evaluates
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control applied throughout
