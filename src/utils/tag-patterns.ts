export const TagPatterns = [
  // HIERARCHY (Keep as Folders)
  { 
    group: "LEVEL", 
    pattern: /^(Primary|Scholarship|Secondary|O\/L|A\/L|[\d\s\-]+Class)\s*Subjects$/i, 
    isHierarchy: true 
  },
  { 
    // Fallback for Levels without "Subjects" if needed, but be careful of collision
    group: "LEVEL",
    pattern: /^(Primary|Scholarship|Secondary)$/i,
    isHierarchy: true 
  },
  { 
    group: "GRADE", 
    pattern: /^Grade\s*(\d{1,2}|0\d)(\s|$)/i, 
    isHierarchy: true 
  },
  { 
    group: "STREAM", 
    pattern: /^(Science|Commerce|Arts|Technology|Tech)(\s+Stream)?$|^(GIT|General\s*English|General\s*Information\s*Technology)$/i, 
    isHierarchy: true 
  },
  
  // ATTRIBUTES (Flatten to Tags)
  { 
    group: "MEDIUM", 
    pattern: /^(Sinhala|Tamil|English)\s*Medium$/i, 
    isHierarchy: false 
  },
  { 
    group: "RESOURCE_TYPE", 
    // Flexible Patterns:
    // Teachers Guide: Teac(any char)Gui(any char)
    // Past Papers: Past(any char)Pap(any char)
    // Marking Schemes: Mark(any char)Sch(any char)
    pattern: /^(Past\s*Pap.*|Marking?\s*Sch.*|Notes?|Short\s*Notes?|Teac?h.*Gui.*|Syllabus|Model\s*Pap.*)$/i, 
    isHierarchy: false 
  },
  {
    group: "EXAM",
    pattern: /^(1st|2nd|3rd|First|Second|Third)?\s*Term(\s*Test)?$|^(Final|Mid)(\s*Term|s*Exam)?$/i,
    isHierarchy: false
  },
  {
      group: "YEAR", // New Attribute
      pattern: /^(20\d{2})$/,
      isHierarchy: false
  }
];

// Helper to determine what a folder is
export function categorizeFolder(name: string) {
  const clean = name.trim();
  
  // Specific fix for "6 - 9 Class Subjects" style
  if (/Subjects$/i.test(clean) && !/^(O\/L|A\/L)/i.test(clean)) {
      // Catch-all for "6-9 Class Subjects", "Primary Class Subjects" if regex missed
      return { group: "LEVEL", isHierarchy: true, pattern: /Subjects$/i };
  }

  for (const p of TagPatterns) {
    if (p.pattern.test(clean)) {
      return p;
    }
  }
  return null; 
}
