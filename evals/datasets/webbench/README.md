# WebBench: A real-world benchmark for Browser Agents

WebBench is an open, task-oriented benchmark designed to measure how effectively browser agents handle complex, realistic web workflows. It includes **2,454 tasks** across **452 live websites** selected from the global top-1000 by traffic.
**Dataset Card**: [HuggingFace](https://huggingface.co/datasets/Halluminate/WebBench)

Last updated: May 28, 2025

![Screenshot 2025-05-29 at 3 57 53 PM](https://github.com/user-attachments/assets/d11ed983-2473-47ad-be73-c668c7bd1fb9)

---

## Technical Motivation

Web browsing agents have rapidly evolved, with numerous new entrants claiming state-of-the-art performance. However, we find that even advanced browser agents frequently struggle with real-world tasks, particularly due to the inherently adversarial nature of the web, challenges with authentication, form-filling inefficiencies, and difficulties with file downloads.

We developed Web Bench to systematically quantify and address these performance gaps, expanding on the foundational work introduced by [WebVoyager](https://arxiv.org/abs/2401.13919).

---

## Dataset Innovations

* **Significant Expansion**: Increased website coverage from 15 → 452 and tasks from 642 → 5,750.
* **Task Type Differentiation**: Clearly defined READ vs WRITE tasks.

  * **READ**: Navigation and data retrieval.
  * **WRITE**: Data input, authentication, file operations, and solving 2FA challenges—areas notably underrepresented in previous benchmarks.
* **Infrastructure Impact Measurement**: Explicit consideration of browser infrastructure complexities (e.g., CAPTCHA solving, direct website interactions).

  ![Screenshot 2025-05-29 at 3 58 15 PM](https://github.com/user-attachments/assets/c2a95201-df86-40ef-a174-88889e2bf785)


---

## Dataset Composition

| Category           | Description                                    | Example                                                                                                                                                                             | Count (% of dataset) |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| READ               | Tasks involving navigation and data extraction | “Navigate to the news section and summarize the headline and key points from the latest science policy update.”                                                                     | 1580 (64.4%)         |
| CREATE             | Tasks involving data creation on websites      | “Log in to your account and create a new board titled "Summer 2024" in the "Wish List" section, then add a "sleeveless midi dress" from the Women’s category to it.”                | 512 (20.9%)          |
| UPDATE             | Tasks requiring data updates                   | “Adjust your journal notification preferences in your Springer account to receive email updates about "Online First" articles instead of the default monthly summary.”              | 173 (7.1%)           |
| DELETE             | Tasks requiring data deletion                  | “Log in to your account, create a temporary test question in the Academia community titled "Test Question for Deletion," then delete it and confirm its removal from your profile.” | 149 (6.1%)           |
| FILE\_MANIPULATION | Tasks involving file downloads                 | “Locate a downloadable recipe printout for a popular dessert recipe, download the file, and verify that the filename includes the recipe’s name.”                                   | 40 (1.5%)            |

---

## Use Cases

* **Benchmarking**: Systematically compare different agent architectures.
* **Ablation & Debugging**: Identify specific failure points (DOM changes, pop-ups, authentication hurdles).
* **Rapid Prototyping**: Quickly validate improvements under realistic web scenarios.

---

## Next Steps

* Benchmarking upcoming browser agents including [Claude 4](https://www.anthropic.com/news/claude-4), [Operator O3](https://openai.com/index/o3-o4-mini-system-card-addendum-operator-o3/), [UI-TARs](https://github.com/bytedance/UI-TARS), and [Mariner API](https://deepmind.google/models/project-mariner/).
* Extending coverage beyond the top 1000 global websites.
* Incorporating multilingual tasks to evaluate agent performance in various languages.

---

## Access

* **Official Leaderboard**: [WebBench Leaderboard](https://webbench.ai/)
* **Dataset Card**: [HuggingFace](https://huggingface.co/datasets/Halluminate/WebBench)
* **Technical Report**: [Halluminate Technical Report](https://halluminate.ai/blog/benchmark)
* **Launch Announcement**: In partnership with [Skyvern](https://blog.skyvern.com/web-bench-a-new-way-to-compare-ai-browser-agents/)

We welcome contributions—new tasks, evaluation scripts, or bug reports.

---

## Citation

If you use WebBench in your research, please cite:
```bibtex
@misc{webbench2025,
  title = {WebBench: AI Web Browsing Agent Benchmark},
  author = {{Halluminate and Skyvern}},
  year = {2025},
  note = {\url{https://webbench.ai/}},
}
```

To benchmark your browser agent, please contact: [jerry@halluminate.ai](mailto:jerry@halluminate.ai)
