export function extractSentences(text: string, maxSentences: number = 5): string {
  if (!text) return "";
  
  // 1. Split into sentences (simple regex for basic punctuation)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= maxSentences) return text.trim();
  
  const tokensList = sentences.map(s => {
    const words = s.toLowerCase().match(/\w+/g) || [];
    // remove some basic stop words
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'of', 'to', 'for', 'it', 'that', 'with']);
    return words.filter(w => !stopWords.has(w));
  });
  
  // 2. Build similarity matrix
  const simMatrix: number[][] = Array(sentences.length).fill(0).map(() => Array(sentences.length).fill(0));
  
  for (let i = 0; i < sentences.length; i++) {
    for (let j = 0; j < sentences.length; j++) {
      if (i === j) continue;
      
      const setA = new Set(tokensList[i]);
      const setB = new Set(tokensList[j]);
      
      let overlap = 0;
      for (const token of setA) {
        if (setB.has(token)) overlap++;
      }
      
      // using log lengths to penalize long sentences dominating
      const lengthScore = Math.log(setA.size) + Math.log(setB.size);
      simMatrix[i][j] = lengthScore <= 0 ? 0 : overlap / lengthScore;
    }
  }
  
  // 3. PageRank (TextRank calculation)
  const d = 0.85; // damping factor
  let scores = Array(sentences.length).fill(1);
  const maxIterations = 20; 
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const newScores = Array(sentences.length).fill(1 - d);
    for (let i = 0; i < sentences.length; i++) {
      for (let j = 0; j < sentences.length; j++) {
        if (i !== j && simMatrix[j][i] > 0) {
          const outDegreeSum = simMatrix[j].reduce((a, b) => a + b, 0);
          if (outDegreeSum > 0) {
             newScores[i] += d * simMatrix[j][i] * scores[j] / outDegreeSum;
          }
        }
      }
    }
    // simple convergence check could go here
    scores = newScores;
  }
  
  // 4. Sort by score and pick topN
  const ranked = sentences
    .map((s, i) => ({ sentence: s, score: scores[i], index: i }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index); // retain original chronological order
    
  return ranked.map(r => r.sentence.trim()).join(' ');
}
