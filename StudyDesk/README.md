# StudyDesk: an adaptive interface demo

A small study dashboard that changes how it looks and behaves while you use it.
Built for the AI-Based Adaptive Human-Computer Interaction assignment (University of the Cumberlands).

## Run it

No install, no server, no packages. Open `index.html` in any modern browser.

To run the unit tests (Node 18 or newer):

```
node tests/model.test.js
```

## What adapts

| Adaptation | Learning method | What the user sees |
|---|---|---|
| Frequently used actions | Recency-weighted frequency scores with hysteresis | A "Your most used" row of up to 3 buttons. The main grid never reorders. |
| Next-action suggestion | First-order Markov chain with Laplace smoothing | A "Next up?" card, shown only when the model is confident. Pressing "Not now" teaches it to suggest that action less. |
| Button size | Moving average of missed clicks | Buttons grow to 120% or 140% when many clicks land in the gaps. |

Every change is listed under "Why things changed", and the "Adapt to my behavior" switch turns all adaptation off.

## Try it quickly

- **Simulate a study routine** replays New task, Calendar, Notes with some random noise.
- **Simulate missed clicks** feeds the pointer model a run of missed clicks.
- **Reset what it learned** clears the saved state.

Both simulations use a fixed random seed, so they look the same each time.

## Files

```
index.html          page structure
css/style.css       styles; button size follows the --target-scale variable
js/model.js         the three learning models (works in browser and Node)
js/app.js           connects the models to the page and explains each change
tests/model.test.js 13 unit tests for the models
docs/               screenshots and figures used in the report
```

## Limits

- It learns from one person's clicks in one browser. State is saved in `localStorage` and nothing leaves the device.
- A "missed click" is approximated as a click on the gap between buttons. It does not detect every kind of pointing difficulty.
- The models are deliberately small. They are real online learning, but not deep learning.

## AI tool disclosure

The code, tests and report draft were produced with help from Claude (Anthropic). See the report for the full disclosure statement.

## References

- Jameson, A. (2003). Adaptive interfaces and agents. In J. A. Jacko & A. Sears (Eds.), *The human-computer interaction handbook* (pp. 305-330). Lawrence Erlbaum.
- Fitts, P. M. (1954). The information capacity of the human motor system in controlling the amplitude of movement. *Journal of Experimental Psychology, 47*(6), 381-391. https://doi.org/10.1037/h0055392
- Sears, A., & Shneiderman, B. (1994). Split menus: Effectively using selection frequency to organize menus. *ACM Transactions on Computer-Human Interaction, 1*(1), 27-51. https://doi.org/10.1145/174630.174632
- Gajos, K. Z., Wobbrock, J. O., & Weld, D. S. (2008). Improving the performance of motor-impaired users with automatically-generated, ability-based interfaces. *Proceedings of CHI 2008*, 1257-1266. https://doi.org/10.1145/1357054.1357250
