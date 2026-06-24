# Upstream Sync System

> **Track, review, and selectively import upstream changes from Zoo-Code-Org/Zoo-Code**

## The Problem

Original repo (`Zoo-Code-Org/Zoo-Code`) naye features aur fixes release karta rahega. Hum **sab kuch nahi chahte** — sirf woh changes jo humein chahiye. Lekin yeh yaad rakhna impossible hai ke "humne last time kis commit tak dekha tha".

## The Solution — 3-Step Workflow

```
pnpm upstream:check     →  Step 1: Dekho kya naya hai
pnpm upstream:import    →  Step 2: Jo pasand aaye wo lo
pnpm upstream:skip      →  Step 3: Jo nahi chahiye wo skip karo
```

### Step 1: Check karo

```bash
pnpm upstream:check
```

Yeh karega:
- Upstream fetch karega (`Zoo-Code-Org/Zoo-Code`)
- Naye commits dikhayega jo last fetch ke baad aaye
- STATE.json update karega
- Koi merge nahi karega — sirf dekhta hai

### Step 2: Import karo (jo chahiye)

```bash
pnpm upstream:import <sha>
```

Yeh karega:
- `git cherry-pick` karega specific commit ko
- STATE.json mein **IMPORTED** mark karega
- Agar conflict aaye toh manually resolve karo, phir script dobara chalao

### Step 3: Skip karo (jo nahi chahiye)

```bash
pnpm upstream:skip <sha> "<reason>"
```

Yeh karega:
- STATE.json mein **SKIPPED** mark karega with reason
- Koi code change nahi — sirf tracking

## Tracking Data (Online!)

Saara tracking **`.upstream/STATE.json`** mein save hota hai jo **GitHub pe commit** ho jata hai. Matlab:

- ✅ Local delete se safe
- ✅ Kisi bhi machine se accessible
- ✅ History visible — kab kya import/skip kiya
- ✅ Team members bhi dekh sakte hain

## STATE.json Content

```json
{
  "lastFetchedCommit": "e8acc6a49...",     // Last upstream HEAD we checked
  "lastFetchedAt": "2026-06-24T...",        // When we last checked
  "pendingCommits": [...],                  // Seen but not yet decided
  "importedCommits": [...],                 // Cherry-picked into our fork
  "skippedCommits": [...],                  // Deliberately skipped (with reasons)
  "lastSyncCommit": null,                   // Last successfully cherry-picked commit
  "lastSyncAt": null                        // When we last imported something
}
```

## Best Practices

1. **Weekly check**: `pnpm upstream:check` run karo regularly
2. **Import immediately**: Agar koi feature pasand hai toh turant import karo (conflicts kam hote hain)
3. **Always write a reason for skip**: Takiyon pata ho kyun skip kiya
4. **Commit after import**: STATE.json ko commit karo taki tracking online rahe
5. **Never `git merge upstream/main`**: Isse sab kuch aa jayega. Sirf cherry-pick use karo.
