Build "Shpilka", a simulation of how an authoritarian hierarchy leaves a tail in election
returns, published at `https://redargum.github.io`.

## What it argues

A resource whose growth rate scales with the amount already held amplifies early asymmetry
until one holder absorbs the rest. Authoritarian consolidation and corporate monopolization
are that mechanism under two vocabularies.

This sketch shows the signature it leaves in data. When a hierarchy distributes resource down
a tree, what each leaf receives is heavy-tailed, not normal. Where that resource buys
enforcement and enforcement moves a reported vote, the distribution of results across polling
stations inherits the tail. The tail is the evidence; the tree is the cause.

One parameter decides which regime appears. Compassion governs how much a node will hoard,
coerce and destroy; drive it down and the cascade steepens until the tail appears, raise it
and the same code produces a normal distribution. The sketch exists to make that sweep
visible.

The name is for Sergey Shpilkin, who reads Russian election returns this way. Shpilka is also
a hairpin and a barbed remark.

## Repository and publication

`redargum/redargum.github.io` is cloned at `~/repos/redargum`, one commit `8bcc802`, branch
`master`. Pages serves that branch from the repository root, which is how the old site was
reachable at `https://redargum.github.io`; do not rename the branch or move the source, or
publication breaks. Delete the abandoned Angular build that is there now (`*.bundle.js`,
`*.map`, `index.html`).

Vanilla HTML, CSS and ES modules — no build step, no npm, no bundler, no dependencies.
`index.html` at the root is the simulation itself, so the site shows the model on load exactly
as the old one showed its app. Add an empty `.nojekyll` so Pages serves the tree verbatim.

```
.nojekyll
index.html          the simulation
css/style.css       :root custom properties, the only colour source
js/model.js         nodes, trees, resource, influence, destruction
js/election.js      station results and the Shpilkin curves
js/view.js          canvases
js/rules.js         the rules panel, generated from the model's parameters
js/spatial.js       uniform-grid neighbour lookup
js/config.js        copy of ~/repos/game/cnspr.github.io/js/config.js
js/debug.js         copy of ~/repos/game/cnspr.github.io/js/debug.js
```

No gallery index and no `common/` directory. A gallery of one is scaffolding; add both when a
second sketch exists.

`config.js` hardcodes `KEY: 'conspiracy_config'`. Change it to `shpilka`.

## Model

Adapted from Pavel Kudinov's Kosmiki (https://habr.com/ru/articles/458612/): agents at 2-D
positions, a uniform grid so each interacts only with near neighbours, and links that carry
something between them. Kosmiki's links are undirected springs carrying force; these are
directed and carry resource.

1. **Node state.** Position `x, y`; alignment `a` in `[-1, +1]` where `-1` is opposition and
   `+1` is mainstream; resource `res`; energy `e`; compassion `c` in `[0, 1]`; parent index;
   voter count `n`, drawn lognormal so stations differ in size the way real ones do.

2. **Two centers, two trees.** Node `0` is the mainstream center at `a = +1`, node `1` the
   opposition center at `a = -1`. Each injects resource per step, the mainstream far more —
   that asymmetry is what makes one of them the state. Every other node holds one parent
   pointer, so the graph is two in-trees plus unattached nodes. Opposition obeys identical
   rules; nothing in the code privileges either side beyond the injection rates.

3. **Directed edges.** Each edge runs parent to child and moves resource that way only:
   `flow = rho * c_parent * res_parent / children(parent)`. Draw the direction — a taper or an
   arrowhead, not a plain line. Without it the two trees read as one undirected mesh and the
   cascade is invisible.

4. **Compassion sets the cascade.** A node passes on a share of its resource scaled by its own
   compassion and keeps the rest. At `c = 1` the tree is nearly flat and every leaf is
   supplied; at `c = 0` each level keeps almost everything and what reaches the periphery is
   heavy-tailed. This is the single term that decides whether a tail exists, so it must be the
   most prominent control on the page.

5. **Re-parenting.** Each node periodically adopts as parent the nearby node with the highest
   `res` whose alignment is nearest its own. The trees assemble themselves by patronage, and a
   node that changes alignment re-attaches to the other tree. This is what makes the
   opposition grow a hierarchy rather than a crowd.

6. **Influence.** A node spends energy to emit influence over radius `R`, strength rising with
   `res` and with `1 - c`: a compassionate node persuades weakly, a ruthless one coerces.
   Each neighbour inside `R` has its alignment pulled toward the emitter's:
   `a_j += k * infl_i * (a_i - a_j) * dt`. This is media and enforcement in one term; they
   differ only in radius and cost, so expose both as separate parameters.

7. **Neglect breeds opposition.** Where received resource falls below a reference, alignment
   drifts negative: `a_i -= lambda * max(0, 1 - res_i / res_ref) * dt`, plus noise. Resource
   decays with depth and the center's supply is finite, so the periphery defects without
   anyone deciding it should. The opposition is a product of the tree, not an input to it.

8. **Destruction.** For a near pair with `|a_i - a_j| > theta / (1 - c_i)`, if `e_i > gamma * e_j`
   then `j` is removed and `e_i` drops by a fixed cost. Its children are orphaned and
   re-parent next step. Compassion raises the gap a node needs before it will destroy, so at
   `c = 1` the term switches itself off. The rule is symmetric: where the opposition is
   locally stronger it destroys mainstream nodes on the same terms.

9. **Repression is not free.** Energy spent on destruction is energy not spent on influence,
   and orphaned subtrees stop returning anything. A regime tuned to purge heavily must lose
   its grip on the periphery. Do not add a term to force this; it should follow from items 6,
   7 and 8, and if it does not, say so rather than patching it.

**Compassion erosion, as a toggle, off by default.** A node that is attacked, or that watches
a neighbour destroyed, loses compassion. Violence then lowers the threshold for more violence
and the model ratchets into the authoritarian regime on its own. Keep it off by default: with
it on, compassion is an outcome and can no longer be swept as a cause, and the sweep is the
point of the page.

## Election and the Shpilkin panel

Each node is a polling station. On each election, from its own state:

- `turnout_i` = a Gaussian baseline plus `beta * enf_i`, clipped to `[0, 1]`
- `share_i` = logistic of `a_i`, inflated toward 1 by `beta2 * enf_i`
- `enf_i` = influence received from the mainstream tree, heavy-tailed because items 3 and 4
  concentrate resource

Plot along the bottom: votes binned over turnout, weighted by `n_i * turnout_i`, one filled
curve per party. The opposition curve stays near Gaussian. The mainstream curve grows a right
tail reaching 100%, because the stations with the most enforcement are both the most mobilized
and the most inflated.

Four things the panel needs beyond the two curves:

1. **The compassion sweep.** A button that steps compassion from 1 down to 0, runs an election
   at each step, and plots administrative share against compassion. That curve is the result
   the page exists to state, and it is worth more than any single frame of the histogram.
2. **The counterfactual.** A control that sets enforcement to zero and re-runs the election.
   Both curves collapse to Gaussian. Without it the tail is an assertion; with it the tail is
   attributable.
3. **Shpilkin's estimate.** Scale the opposition curve to the mainstream curve's left flank,
   subtract, integrate the excess, report it as the administrative share of the vote. This is
   his actual method, it turns the picture into a number, and it is what the sweep plots.
4. **Round-number targets, as a toggle.** Where `enf_i` passes a threshold the station is
   working to a quota, so snap `share_i` to the nearest 5%. This produces the comb of spikes
   at 70, 75, 80, 85, 90, 95 and 100% that is the most recognizable signature in the real
   data. Off by default, so the tail is seen to come from the cascade and not from rounding.

Add a small second panel: turnout against mainstream share, one point per station. A clean
election is a blob; this one grows a streak toward the top-right corner.

## The rules button

A button that opens a panel listing every rule the simulation runs, one line each, with the
live value of each parameter beside it. A visitor should be able to read the whole model in
under a minute without leaving the page.

Generate the lines from the same parameter objects the model reads, not from a hand-written
copy. A duplicated description drifts from the code within a week, and a rules panel that lies
is worse than none.

## Display

Decouple the redraw rates — the network can run at 30 fps and the histogram at 10 without
anything looking wrong.

1. **Network.** Nodes splatted into one `ImageData`, coloured by alignment and sized by
   `log(res)`. Edges in a single batched path — one `beginPath()`, all segments, one
   `stroke()`. Per-node `arc()` calls will not hold the frame rate at `N = 20000`.
2. **Shpilkin histogram**, across the full width of the bottom.
3. **Turnout-share scatter** and **the compassion sweep**, beside it.
4. **A compassion meter**, reading the population mean, placed where it cannot be missed.

`N = 20000` is the default. Real returns come from roughly 95000 stations, and below a few
thousand the histogram is too noisy to read a tail off. The frame budget at that size is a
guess until measured; if it does not hold, cut the network redraw rate before cutting `N`,
since the histogram is the point.

## Controls

Compassion first and largest. Then resource injection for each center, `rho`, influence radius
and cost, media radius and cost, `theta`, `gamma`, `lambda`, `N`, election interval, plus
reset, pause and speed. Persist through `config.js`.

Ship three presets: a compassionate one where both trees hold territory and both curves stay
Gaussian; a ruthless one where the mainstream tree fills the map and the tail appears within
seconds; and an over-repressive one where purging costs the center its periphery and the tail
shrinks again. Load the ruthless one first.

## What the sketch has to show

A visitor who touches nothing sees a tree fill the space, the periphery turn against it, and a
right tail grow on the mainstream curve while the opposition curve stays symmetric. A visitor
who raises compassion watches the same code flatten that tail into a normal distribution, and
the sweep plot says where the transition sits. That pair is the argument; build toward it and
drop anything that does not serve it.

## Constraints

Comments at most one line, and only where the code cannot say it. No framework. Verify by
loading `https://redargum.github.io` after the push and comparing the two curves, not by
unit-testing the integrator.
