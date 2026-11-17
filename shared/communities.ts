export interface Community {
  id: string;
  parentId: string | null;
  name: { en: string; ru: string };
}

// Stable IDs and parentage are reviewed in code; memberships live in PostgreSQL.
export const communities: Community[] = [
  { id: 'university_students', parentId: null, name: { en: 'University students', ru: 'Студенты вузов' } },
  { id: 'israeli_university_students', parentId: 'university_students', name: { en: 'Students at Israeli universities', ru: 'Студенты израильских вузов' } },
  { id: 'ariel_students', parentId: 'israeli_university_students', name: { en: 'Ariel University students', ru: 'Студенты Ариэльского университета' } },
];

export function communityAncestors(id: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = communities.find(item => item.id === id);
  while (current && !seen.has(current.id)) {
    result.push(current.id); seen.add(current.id);
    current = communities.find(item => item.id === current?.parentId);
  }
  return result;
}
