import { describe, expect, it } from "vitest";
import { needsPackageReview } from "./clients";
import { packageReviewDismissals, simplePackageClientIds } from "./simple-package-review";

const active = {status:"active",deleted_at:null,package_price:0,package_total_visits:0,amount_paid:375};
const empty = new Set<string>();
describe("simple package review across profile, client list, dashboard and scheduling",()=>{
  it("a non-deleted simple package resolves legacy blank package fields",()=>{
    const packages=simplePackageClientIds([{client_id:"c",deleted_at:null}]);
    expect(needsPackageReview(active,empty,"c",packages)).toBe(false);
  });
  it("legacy package pricing cannot resolve a missing simple package",()=>{
    const legacyPriced = {...active,package_price:375,package_total_visits:8};
    expect(needsPackageReview(legacyPriced,empty,"c",empty)).toBe(true);
  });
  it("deleted simple packages no longer resolve review",()=>{
    expect(needsPackageReview(active,empty,"c",simplePackageClientIds([{client_id:"c",deleted_at:"2026-11-24"}]))).toBe(true);
  });
  it("any non-deleted row, including opening or zero-price packages, resolves existence",()=>{
    expect(needsPackageReview(active,empty,"c",simplePackageClientIds([{client_id:"other",deleted_at:null},{client_id:"c",deleted_at:null}]))).toBe(false);
  });
  it("archived and deleted clients are excluded",()=>{
    expect(needsPackageReview({...active,status:"archived"},empty,"c",empty)).toBe(false);
    expect(needsPackageReview({...active,deleted_at:"2026-11-24"},empty,"c",empty)).toBe(false);
  });
  it("no-package-needed dismissal suppresses review until explicit undo",()=>{
    const rows=[{client_id:"c",activity_type:"package_review_dismissed",created_at:"2026-11-24T16:00:00Z"}];
    expect(needsPackageReview(active,packageReviewDismissals(rows),"c",empty)).toBe(false);
    rows.unshift({client_id:"c",activity_type:"package_review_redo",created_at:"2026-11-24T17:00:00Z"});
    expect(needsPackageReview(active,packageReviewDismissals(rows),"c",empty)).toBe(true);
  });
  it("missing package or dismissal evidence does not fabricate a setup gap",()=>{
    expect(needsPackageReview(active,empty,"c",null)).toBe(false);
    expect(needsPackageReview(active,null,"c",empty)).toBe(false);
  });
});