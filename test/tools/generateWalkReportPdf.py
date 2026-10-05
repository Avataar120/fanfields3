#!/usr/bin/env python3
"""Turns a report_data.json produced by exportWalkReport.js into a step-by-step PDF: one page per
portal in the walk, showing the links thrown there (with fields completed) and a map of the plan
so far (links/fields already done vs. done at this step).

Usage: python test/tools/generateWalkReportPdf.py <reportJson> <outputPdf>
"""

import json
import sys

from matplotlib.backends.backend_pdf import PdfPages
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.lines import Line2D

if len(sys.argv) < 3:
    print('Usage: python test/tools/generateWalkReportPdf.py <reportJson> <outputPdf>')
    sys.exit(1)

report_json, output_pdf = sys.argv[1], sys.argv[2]

with open(report_json, encoding='utf-8') as f:
    data = json.load(f)

portals = data['portals']
by_guid = {p['guid']: p for p in portals}
steps = data['steps']
link_seq = data['linkSeq']
triangle_guids = data['triangleGuids']
field_completion_step = data['fieldCompletionStep']
title_suffix = f"{data.get('mode', '?')} — ancre : {data.get('anchorTitle', '?')}"

all_lats = [p['lat'] for p in portals]
all_lngs = [p['lng'] for p in portals]
lat_margin = (max(all_lats) - min(all_lats)) * 0.08 or 0.001
lng_margin = (max(all_lngs) - min(all_lngs)) * 0.08 or 0.001
xlim = (min(all_lngs) - lng_margin, max(all_lngs) + lng_margin)
ylim = (min(all_lats) - lat_margin, max(all_lats) + lat_margin)


def draw_map(ax, step_index):
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect('equal')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

    ax.scatter([p['lng'] for p in portals], [p['lat'] for p in portals], s=8, c='#999999', zorder=2)

    for (a, b, c), comp_step in zip(triangle_guids, field_completion_step):
        if comp_step is None or comp_step > step_index:
            continue
        pts = [(by_guid[g]['lng'], by_guid[g]['lat']) for g in (a, b, c)]
        color = '#ff4d4d' if comp_step == step_index else '#cccccc'
        alpha = 0.55 if comp_step == step_index else 0.35
        ax.add_patch(Polygon(pts, closed=True, facecolor=color, edgecolor='none', alpha=alpha, zorder=1))

    for link in link_seq:
        if link['stepIndex'] > step_index:
            continue
        src = by_guid[link['srcGuid']]
        dst = by_guid[link['dstGuid']]
        color = '#e60000' if link['stepIndex'] == step_index else '#333333'
        lw = 2.0 if link['stepIndex'] == step_index else 0.8
        z = 4 if link['stepIndex'] == step_index else 3
        ax.plot([src['lng'], dst['lng']], [src['lat'], dst['lat']], color=color, linewidth=lw,
                zorder=z, solid_capstyle='round')

    walked = steps[:step_index + 1]
    ax.plot([s['lng'] for s in walked], [s['lat'] for s in walked], color='#1f6feb', linewidth=1.0,
             linestyle=(0, (3, 2)), zorder=5, alpha=0.6)
    cur = steps[step_index]
    ax.scatter([cur['lng']], [cur['lat']], s=90, facecolor='#1f6feb', edgecolor='white', linewidth=1.2, zorder=6)


def draw_text_panel(ax, step_index):
    ax.axis('off')
    s = steps[step_index]
    lines = [
        f"Étape {step_index + 1}/{len(steps)}",
        "",
        f"Portail : {s['title']}",
        f"Distance depuis le portail précédent : {s['distFromPrev']:.0f} m",
        f"Distance totale parcourue : {s['cumulativeDist']:.0f} m",
        "",
    ]
    if s['links']:
        lines.append("Liens à tirer ici, dans l'ordre :")
        for i, l in enumerate(s['links'], 1):
            field_txt = {0: '0 field', 1: '1 field'}.get(l['newFields'], f"{l['newFields']} fields")
            lines.append(f"  {i}. -> {l['destTitle']}  ({field_txt})")
    else:
        lines.append('Aucun lien à tirer ici.')

    legend_elems = [
        Line2D([0], [0], color='#333333', lw=1.5, label='Liens déjà tirés'),
        Line2D([0], [0], color='#e60000', lw=2.5, label='Nouveaux liens (cette étape)'),
        Line2D([0], [0], marker='s', color='none', markerfacecolor='#cccccc', markersize=10, label='Fields déjà formés'),
        Line2D([0], [0], marker='s', color='none', markerfacecolor='#ff4d4d', markersize=10, label='Nouveaux fields (cette étape)'),
        Line2D([0], [0], color='#1f6feb', lw=1.2, linestyle=(0, (3, 2)), label='Trajet à pied'),
    ]

    ax.text(0.02, 0.98, '\n'.join(lines), transform=ax.transAxes, fontsize=10, va='top', ha='left', family='monospace')
    ax.legend(handles=legend_elems, loc='lower left', fontsize=8, frameon=False, bbox_to_anchor=(0.0, 0.0))


with PdfPages(output_pdf) as pdf:
    for i in range(len(steps)):
        fig, (ax_map, ax_text) = plt.subplots(1, 2, figsize=(11.5, 6.0), gridspec_kw={'width_ratios': [1.3, 1]})
        draw_map(ax_map, i)
        draw_text_panel(ax_text, i)
        fig.suptitle(f"Fan Fields 3 — {title_suffix} — étape {i + 1}/{len(steps)}", fontsize=11)
        fig.tight_layout(rect=[0, 0, 1, 0.95])
        pdf.savefig(fig)
        plt.close(fig)

print('PDF written:', output_pdf)
