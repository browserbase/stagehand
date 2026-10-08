# Recorder eligibility audit

Audited all 37 extraction and observation benchmarks on 2026-10-07. Seven are migrated in this PR; all supported candidates that passed the fidelity checks are included. The other 30 remain live for the reasons below. Action benchmarks and core browser checks are outside this observation-only recorder’s scope.

Eligibility requires a reachable source, recorder support, preserved observation content, unchanged scoring, and successful local and remote replay. A capture that merely serializes successfully is not enough. No source pages, scoring assertions, or recorder limitations were changed to make a task eligible.

| Task                             | Decision  | Evidence                                                                                                         |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `extract_aigrant_targeted`       | Recorded  | Preserved source observation and original task assertions.                                                       |
| `extract_aigrant_targeted_2`     | Recorded  | Preserved source observation and original task assertions.                                                       |
| `extract_apartments`             | Keep live | Source returned Access Denied; no valid listing page to capture.                                                 |
| `extract_area_codes`             | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_baptist_health`         | Keep live | Capture loses nonempty accessible text, including menu and direction labels.                                     |
| `extract_csa`                    | Recorded  | Preserved source observation and original task assertions.                                                       |
| `extract_geniusee`               | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_geniusee_2`             | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_github_stars`           | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_hamilton_weather`       | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_jfk_links`              | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_jstor_news`             | Keep live | Closes a cookie banner with `act` before extraction.                                                             |
| `extract_memorial_healthcare`    | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_nhl_stats`              | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_professional_info`      | Recorded  | Preserved source observation and original task assertions.                                                       |
| `extract_public_notices`         | Keep live | Capture loses nonempty social-link text (Whatsapp, Facebook, Youtube, Linkedin, Rss).                            |
| `extract_recipe`                 | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_regulations_table`      | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_repo_name`              | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_resistor_info`          | Recorded  | Preserved source observation and original task assertions.                                                       |
| `extract_rockauto`               | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_single_link`            | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `extract_staff_members`          | Keep live | Replay exposes a language selector absent from the source observation.                                           |
| `extract_zillow`                 | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `iframe_hn`                      | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `ionwave_observe`                | Recorded  | Preserved source observation and original task assertions.                                                       |
| `observe_amazon_add_to_cart`     | Keep live | Executes observed actions and checks resulting cart behavior.                                                    |
| `observe_file_uploads`           | Recorded  | Preserved source observation and original task assertions.                                                       |
| `observe_github`                 | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `observe_iframes1`               | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `observe_iframes2`               | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `observe_main_frame_element_ids` | Keep live | Clicks controls and checks JavaScript state.                                                                     |
| `observe_simple_google_search`   | Keep live | Types, submits, and checks the resulting URL.                                                                    |
| `observe_taxes`                  | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `observe_vantechjournal`         | Keep live | Frames or shadow DOM: unsupported by the recorder (explicit iframe tasks or capture rejection).                  |
| `observe_yc_startup`             | Keep live | Source no longer contains either of the original expected container selectors; baseline needs a separate repair. |
| `panamcs`                        | Keep live | Replay exposes a language selector absent from the source observation.                                           |

The 30 exclusions comprise 20 frame/shadow-DOM tasks, four interaction-dependent tasks, four observed fidelity failures, and two source/baseline blockers. These are documented exclusions, not unreviewed migration candidates.

Fidelity comparisons normalize session-local element IDs, whitespace-only `StaticText` nodes, and blank link names. They retain all nonempty accessible text, other roles, hierarchy, and values. The latter two normalizations account for the CSA breadcrumb separator and Ionwave’s unnamed link; they do not excuse lost words or added controls.

Captures for rejected candidates were kept outside the repository. Extending recorder support or repairing unrelated live baselines is separate work.
