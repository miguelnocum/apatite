import { KEY } from '../core/example-data.js';
import { texInline } from './equation-tex.js';

/* ===== the equation editor's menus, as in Word: each opens a gallery of layouts (□ are boxes to type in; anything
   selected goes in the first box) in sections, ending with common ready-made ones. An item is [name, LaTeX, "w" for a wide tile]. ===== */
export var EQ_MENUS = [
  [
    'Fraction',
    '\\frac{x}{y}',
    [
      [
        'Fraction',
        [
          ['Stacked fraction', '\\frac{#0}{#?}'],
          ['Skewed fraction', '{}^{#0}\\!/_{#?}'],
          ['Linear fraction', '#0/#?'],
          ['Small fraction', '\\tfrac{#0}{#?}']
        ]
      ],
      [
        'Common fractions',
        [
          ['dy over dx', '\\frac{dy}{dx}'],
          ['Change in y over change in x', '\\frac{\\Delta y}{\\Delta x}'],
          ['Partial derivative', '\\frac{\\partial y}{\\partial x}'],
          ['Small change', '\\frac{\\delta y}{\\delta x}'],
          ['Pi over 2', '\\frac{\\pi}{2}'],
          ['One over n', '\\frac{1}{n}']
        ]
      ]
    ]
  ],
  [
    'Script',
    'e^{x}',
    [
      [
        'Subscripts and superscripts',
        [
          ['Superscript (power)', '#0^{#?}'],
          ['Subscript', '#0_{#?}'],
          ['Subscript and superscript', '#0_{#?}^{#?}'],
          ['Scripts on the left', '{}_{#?}^{#?}#0']
        ]
      ],
      [
        'Common',
        [
          ['x sub y squared', 'x_{y^2}'],
          ['e to the minus i omega t', 'e^{-i\\omega t}'],
          ['x squared', 'x^{2}'],
          ['n over 1 Y', '{}_{1}^{n}Y'],
          ['x sub i', 'x_{i}'],
          ['Transpose', '#0^{T}'],
          ['Inverse', '#0^{-1}'],
          ['Prime', '#0^{\\prime}']
        ]
      ]
    ]
  ],
  [
    'Radical',
    '\\sqrt[n]{x}',
    [
      [
        'Radicals',
        [
          ['Square root', '\\sqrt{#0}'],
          ['Root with a degree', '\\sqrt[#?]{#0}'],
          ['Square root (with the 2)', '\\sqrt[2]{#0}'],
          ['Cube root', '\\sqrt[3]{#0}']
        ]
      ],
      [
        'Common',
        [
          ['Quadratic formula', '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', 'w'],
          ['Length of a vector', '\\sqrt{a^2+b^2}', 'w']
        ]
      ]
    ]
  ],
  [
    'Integral',
    '\\int_{-x}^{x}',
    [
      [
        'Integrals',
        [
          ['Integral', '\\int #0'],
          ['Integral, limits beside', '\\int_{#?}^{#?} #0'],
          ['Integral, limits above and below', '\\int\\limits_{#?}^{#?} #0'],
          ['Double integral', '\\iint #0'],
          ['Double integral, limits beside', '\\iint_{#?}^{#?} #0'],
          ['Double integral, limits above and below', '\\iint\\limits_{#?}^{#?} #0'],
          ['Triple integral', '\\iiint #0'],
          ['Triple integral, limits beside', '\\iiint_{#?}^{#?} #0'],
          ['Triple integral, limits above and below', '\\iiint\\limits_{#?}^{#?} #0']
        ]
      ],
      [
        'Contour integrals',
        [
          ['Contour integral', '\\oint #0'],
          ['Contour integral, limits beside', '\\oint_{#?}^{#?} #0'],
          ['Contour integral, limits above and below', '\\oint\\limits_{#?}^{#?} #0'],
          ['Surface integral', '\\oiint #0'],
          ['Surface integral, limits beside', '\\oiint_{#?}^{#?} #0'],
          ['Surface integral, limits above and below', '\\oiint\\limits_{#?}^{#?} #0'],
          ['Volume integral', '\\oiiint #0'],
          ['Volume integral, limits beside', '\\oiiint_{#?}^{#?} #0'],
          ['Volume integral, limits above and below', '\\oiiint\\limits_{#?}^{#?} #0']
        ]
      ],
      [
        'Differentials',
        [
          ['dx', '\\,dx'],
          ['dy', '\\,dy'],
          ['d theta', '\\,d\\theta']
        ]
      ],
      [
        'Common',
        [
          ['Integral from 0 to 1', '\\int_{0}^{1} f(x)\\,dx', 'w'],
          ['Integral over all x', '\\int_{-\\infty}^{\\infty} p(x)\\,dx', 'w']
        ]
      ]
    ]
  ],
  [
    'Large Operator',
    '\\sum_{i=0}^{n}',
    [
      [
        'Summations',
        [
          ['Sum', '\\sum #0'],
          ['Sum, limits above and below', '\\sum_{#?}^{#?} #0'],
          ['Sum, limits beside', '\\sum\\nolimits_{#?}^{#?} #0'],
          ['Sum, below only', '\\sum_{#?} #0'],
          ['Sum, below only, beside', '\\sum\\nolimits_{#?} #0']
        ]
      ],
      [
        'Products and co-products',
        [
          ['Product', '\\prod #0'],
          ['Product, limits above and below', '\\prod_{#?}^{#?} #0'],
          ['Product, limits beside', '\\prod\\nolimits_{#?}^{#?} #0'],
          ['Product, below only', '\\prod_{#?} #0'],
          ['Product, below only, beside', '\\prod\\nolimits_{#?} #0'],
          ['Co-product', '\\coprod #0'],
          ['Co-product, limits above and below', '\\coprod_{#?}^{#?} #0'],
          ['Co-product, limits beside', '\\coprod\\nolimits_{#?}^{#?} #0'],
          ['Co-product, below only', '\\coprod_{#?} #0'],
          ['Co-product, below only, beside', '\\coprod\\nolimits_{#?} #0']
        ]
      ],
      [
        'Unions and intersections',
        [
          ['Union', '\\bigcup #0'],
          ['Union, limits above and below', '\\bigcup_{#?}^{#?} #0'],
          ['Union, limits beside', '\\bigcup\\nolimits_{#?}^{#?} #0'],
          ['Union, below only', '\\bigcup_{#?} #0'],
          ['Union, below only, beside', '\\bigcup\\nolimits_{#?} #0'],
          ['Intersection', '\\bigcap #0'],
          ['Intersection, limits above and below', '\\bigcap_{#?}^{#?} #0'],
          ['Intersection, limits beside', '\\bigcap\\nolimits_{#?}^{#?} #0'],
          ['Intersection, below only', '\\bigcap_{#?} #0'],
          ['Intersection, below only, beside', '\\bigcap\\nolimits_{#?} #0']
        ]
      ],
      [
        'Other large operators',
        [
          ['Logical or', '\\bigvee #0'],
          ['Logical or, limits above and below', '\\bigvee_{#?}^{#?} #0'],
          ['Logical or, limits beside', '\\bigvee\\nolimits_{#?}^{#?} #0'],
          ['Logical or, below only', '\\bigvee_{#?} #0'],
          ['Logical or, below only, beside', '\\bigvee\\nolimits_{#?} #0'],
          ['Logical and', '\\bigwedge #0'],
          ['Logical and, limits above and below', '\\bigwedge_{#?}^{#?} #0'],
          ['Logical and, limits beside', '\\bigwedge\\nolimits_{#?}^{#?} #0'],
          ['Logical and, below only', '\\bigwedge_{#?} #0'],
          ['Logical and, below only, beside', '\\bigwedge\\nolimits_{#?} #0']
        ]
      ],
      [
        'Common',
        [
          ['Binomial sum', '\\sum_{k}\\binom{n}{k}'],
          ['Sum from i = 0 to n', '\\sum_{i=0}^{n} #0'],
          ['Double condition', '\\sum_{\\substack{0\\le i\\le m\\\\0<j<n}} P(i,j)', 'w'],
          ['Product from k = 1 to n', '\\prod_{k=1}^{n} A_k'],
          ['Union of intersections', '\\bigcup_{n=1}^{m}\\left(X_n\\cap Y_n\\right)', 'w'],
          ['Mean', '\\frac{1}{n}\\sum_{i=1}^{n} x_i', 'w']
        ]
      ]
    ]
  ],
  [
    'Bracket',
    '\\{()\\}',
    [
      [
        'Brackets',
        [
          ['Round brackets', '\\left(#0\\right)'],
          ['Square brackets', '\\left[#0\\right]'],
          ['Curly brackets', '\\left\\{#0\\right\\}'],
          ['Angle brackets', '\\left\\langle #0\\right\\rangle'],
          ['Floor', '\\left\\lfloor #0\\right\\rfloor'],
          ['Ceiling', '\\left\\lceil #0\\right\\rceil'],
          ['Absolute value', '\\left|#0\\right|'],
          ['Norm (length)', '\\left\\lVert #0\\right\\rVert'],
          ['Half-open on the right', '\\left[#0\\right['],
          ['Half-open on the left', '\\left]#0\\right]'],
          ['Open interval', '\\left]#0\\right['],
          ['Double square brackets', '\\left[\\!\\left[#0\\right]\\!\\right]']
        ]
      ],
      [
        'Brackets with separators',
        [
          ['Round, with a bar', '\\left(#0\\,\\middle|\\,#?\\right)'],
          ['Curly, with a bar', '\\left\\{#0\\,\\middle|\\,#?\\right\\}'],
          ['Angle, with a bar', '\\left\\langle #0\\,\\middle|\\,#?\\right\\rangle'],
          ['Angle, two bars', '\\left\\langle #0\\,\\middle|\\,#?\\,\\middle|\\,#?\\right\\rangle']
        ]
      ],
      [
        'Single brackets',
        [
          ['Left round', '\\left(#0\\right.'],
          ['Right round', '\\left.#0\\right)'],
          ['Left square', '\\left[#0\\right.'],
          ['Right square', '\\left.#0\\right]'],
          ['Left curly', '\\left\\{#0\\right.'],
          ['Right curly', '\\left.#0\\right\\}'],
          ['Left angle', '\\left\\langle #0\\right.'],
          ['Right angle', '\\left.#0\\right\\rangle'],
          ['Left floor', '\\left\\lfloor #0\\right.'],
          ['Right floor', '\\left.#0\\right\\rfloor'],
          ['Left ceiling', '\\left\\lceil #0\\right.'],
          ['Right ceiling', '\\left.#0\\right\\rceil'],
          ['Left bar', '\\left|#0\\right.'],
          ['Right bar', '\\left.#0\\right|'],
          ['Left double bar', '\\left\\lVert #0\\right.'],
          ['Right double bar', '\\left.#0\\right\\rVert']
        ]
      ],
      [
        'Cases and stacks',
        [
          ['Cases (two)', '\\begin{cases}#?\\\\#?\\end{cases}'],
          ['Cases (three)', '\\begin{cases}#?\\\\#?\\\\#?\\end{cases}'],
          ['Stack', '\\begin{matrix}#?\\\\#?\\end{matrix}'],
          ['Stack in brackets', '\\begin{pmatrix}#?\\\\#?\\end{pmatrix}'],
          ['Cases with conditions', '\\begin{cases}#? & #?\\\\ #? & #?\\end{cases}']
        ]
      ],
      [
        'Common',
        [
          ['Absolute value as cases', 'f(x)=\\begin{cases}-x, & x<0\\\\ x, & x\\ge 0\\end{cases}', 'w'],
          ['n choose k', '\\binom{n}{k}'],
          ['n choose k, in angles', '\\left\\langle\\genfrac{}{}{0pt}{}{n}{k}\\right\\rangle'],
          ['Pairs', '\\left\\{x_i,y_i\\right\\}']
        ]
      ]
    ]
  ],
  [
    'Function',
    '\\sin\\theta',
    [
      [
        'Trigonometric functions',
        [
          ['Sine', '\\sin #0'],
          ['Cosine', '\\cos #0'],
          ['Tangent', '\\tan #0'],
          ['Cosecant', '\\csc #0'],
          ['Secant', '\\sec #0'],
          ['Cotangent', '\\cot #0']
        ]
      ],
      [
        'Inverse functions',
        [
          ['Inverse sine', '\\sin^{-1} #0'],
          ['Inverse cosine', '\\cos^{-1} #0'],
          ['Inverse tangent', '\\tan^{-1} #0'],
          ['Inverse cosecant', '\\csc^{-1} #0'],
          ['Inverse secant', '\\sec^{-1} #0'],
          ['Inverse cotangent', '\\cot^{-1} #0']
        ]
      ],
      [
        'Hyperbolic functions',
        [
          ['Hyperbolic sine', '\\sinh #0'],
          ['Hyperbolic cosine', '\\cosh #0'],
          ['Hyperbolic tangent', '\\tanh #0'],
          ['Hyperbolic cosecant', '\\operatorname{csch} #0'],
          ['Hyperbolic secant', '\\operatorname{sech} #0'],
          ['Hyperbolic cotangent', '\\coth #0']
        ]
      ],
      [
        'Inverse hyperbolic functions',
        [
          ['Inverse hyperbolic sine', '\\sinh^{-1} #0'],
          ['Inverse hyperbolic cosine', '\\cosh^{-1} #0'],
          ['Inverse hyperbolic tangent', '\\tanh^{-1} #0'],
          ['Inverse hyperbolic cosecant', '\\operatorname{csch}^{-1} #0'],
          ['Inverse hyperbolic secant', '\\operatorname{sech}^{-1} #0'],
          ['Inverse hyperbolic cotangent', '\\coth^{-1} #0']
        ]
      ],
      [
        'Common',
        [
          ['sin theta', '\\sin\\theta'],
          ['cos 2x', '\\cos 2x'],
          ['Tangent identity', '\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}', 'w'],
          ['Sigmoid', '\\sigma(x)=\\frac{1}{1+e^{-x}}', 'w'],
          ['Function of', '#?\\left(#0\\right)'],
          ['Exponential', '\\exp #0']
        ]
      ]
    ]
  ],
  [
    'Accent',
    '\\ddot{a}',
    [
      [
        'Accents',
        [
          ['Dot', '\\dot{#0}'],
          ['Double dot', '\\ddot{#0}'],
          ['Triple dot', '\\overset{\\ldots}{#0}'],
          ['Hat (an estimate)', '\\hat{#0}'],
          ['Check', '\\check{#0}'],
          ['Acute', '\\acute{#0}'],
          ['Grave', '\\grave{#0}'],
          ['Breve', '\\breve{#0}'],
          ['Tilde', '\\tilde{#0}'],
          ['Bar (a mean)', '\\bar{#0}'],
          ['Double bar', '\\bar{\\bar{#0}}'],
          ['Brace over', '\\overbrace{#0}'],
          ['Brace under', '\\underbrace{#0}'],
          ['Brace over, with words', '\\overbrace{#0}^{#?}'],
          ['Brace under, with words', '\\underbrace{#0}_{#?}'],
          ['Arrow over, left', '\\overleftarrow{#0}'],
          ['Arrow over, right (vector)', '\\overrightarrow{#0}'],
          ['Arrow over, both ways', '\\overleftrightarrow{#0}'],
          ['Harpoon over, left', '\\overleftharpoon{#0}'],
          ['Harpoon over, right', '\\overrightharpoon{#0}'],
          ['Vector arrow', '\\vec{#0}'],
          ['Bold (vectors, matrices; Greek too)', '\\boldsymbol{#0}']
        ]
      ],
      [
        'Boxed formulas',
        [
          ['Boxed', '\\boxed{#0}'],
          ['Boxed example', '\\boxed{a^2=b^2+c^2}', 'w']
        ]
      ],
      [
        'Overbars and underbars',
        [
          ['Line over', '\\overline{#0}'],
          ['Line under', '\\underline{#0}']
        ]
      ],
      [
        'Common',
        [
          ['A bar', '\\overline{A}'],
          ['ABC bar', '\\overline{ABC}'],
          ['x xor y', '\\overline{x\\oplus y}'],
          ['y hat', '\\hat{y}'],
          ['x bar', '\\bar{x}'],
          ['Bold w', '\\boldsymbol{w}'],
          ['Bold phi', '\\boldsymbol{\\phi}']
        ]
      ]
    ]
  ],
  [
    'Limit and Log',
    '\\lim_{n\\to\\infty}',
    [
      [
        'Functions',
        [
          ['Log with a base', '\\log_{#?} #0'],
          ['Logarithm', '\\log #0'],
          ['Limit', '\\lim_{#?} #0'],
          ['Minimum over', '\\min_{#?} #0'],
          ['Maximum over', '\\max_{#?} #0'],
          ['Natural log', '\\ln #0'],
          ['Arg min (the value that makes it smallest)', '\\operatorname*{argmin}_{#?} #0'],
          ['Arg max (the value that makes it largest)', '\\operatorname*{argmax}_{#?} #0']
        ]
      ],
      [
        'Common',
        [
          ['Limit of (1 + 1/n) to the n', '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}', 'w'],
          ['Maximum on [0,1]', '\\max_{0\\le x\\le 1} xe^{-x^2}', 'w'],
          ['Limit as x goes to 0', '\\lim_{x\\to 0}'],
          ['Log base 2', '\\log_{2}'],
          ['Arg min over phi', '\\operatorname*{argmin}_{\\boldsymbol{\\phi}}', 'w']
        ]
      ]
    ]
  ],
  [
    'Operator',
    '\\stackrel{\\Delta}{=}',
    [
      [
        'Basic operators',
        [
          ['Defined as', '\\coloneqq'],
          ['Equal equal', '=='],
          ['Plus equals', '+='],
          ['Minus equals', '-='],
          ['Equal by definition', '\\stackrel{\\text{def}}{=}'],
          ['Equal by measure', '\\stackrel{\\text{m}}{=}'],
          ['Delta equal', '\\triangleq']
        ]
      ],
      [
        'Operator structures',
        [
          ['Arrow left, words below', '\\xleftarrow[#?]{}'],
          ['Arrow right, words below', '\\xrightarrow[#?]{}'],
          ['Arrow left, words above', '\\xleftarrow{#?}'],
          ['Arrow right, words above', '\\xrightarrow{#?}'],
          ['Double arrow left, words below', '\\xLeftarrow[#?]{}'],
          ['Double arrow right, words below', '\\xRightarrow[#?]{}'],
          ['Double arrow left, words above', '\\xLeftarrow{#?}'],
          ['Double arrow right, words above', '\\xRightarrow{#?}'],
          ['Both ways, words below', '\\xleftrightarrow[#?]{}'],
          ['Both ways, words above', '\\xleftrightarrow{#?}'],
          ['Double both ways, words below', '\\xLeftrightarrow[#?]{}'],
          ['Double both ways, words above', '\\xLeftrightarrow{#?}'],
          ['Something over', '\\overset{#?}{#0}'],
          ['Something under', '\\underset{#?}{#0}']
        ]
      ],
      [
        'Common',
        [
          ['Yields', '\\xrightarrow{\\text{yields}}'],
          ['Delta arrow', '\\xrightarrow{\\Delta}'],
          ['Implies', '\\Rightarrow'],
          ['If and only if', '\\iff'],
          ['Goes to', '\\to'],
          ['Maps to', '\\mapsto']
        ]
      ]
    ]
  ],
  [
    'Matrix',
    '\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}',
    [
      [
        'Empty matrices',
        [
          ['1 by 2', '\\begin{matrix}#?&#?\\end{matrix}'],
          ['2 by 1', '\\begin{matrix}#?\\\\#?\\end{matrix}'],
          ['1 by 3', '\\begin{matrix}#?&#?&#?\\end{matrix}'],
          ['3 by 1', '\\begin{matrix}#?\\\\#?\\\\#?\\end{matrix}'],
          ['2 by 2', '\\begin{matrix}#?&#?\\\\#?&#?\\end{matrix}'],
          ['2 by 3', '\\begin{matrix}#?&#?&#?\\\\#?&#?&#?\\end{matrix}'],
          ['3 by 2', '\\begin{matrix}#?&#?\\\\#?&#?\\\\#?&#?\\end{matrix}'],
          ['3 by 3', '\\begin{matrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{matrix}']
        ]
      ],
      [
        'Dots',
        [
          ['Centre dots', '\\cdots'],
          ['Low dots', '\\ldots'],
          ['Vertical dots', '\\vdots'],
          ['Diagonal dots', '\\ddots']
        ]
      ],
      [
        'Identity matrices',
        [
          ['2 by 2 identity', '\\begin{matrix}1&0\\\\0&1\\end{matrix}'],
          ['2 by 2 identity (zeros left out)', '\\begin{matrix}1&\\\\&1\\end{matrix}'],
          ['3 by 3 identity', '\\begin{matrix}1&0&0\\\\0&1&0\\\\0&0&1\\end{matrix}'],
          ['3 by 3 identity (zeros left out)', '\\begin{matrix}1&&\\\\&1&\\\\&&1\\end{matrix}']
        ]
      ],
      [
        'Matrices with brackets',
        [
          ['In round brackets', '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}'],
          ['In square brackets', '\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}'],
          ['Determinant (bars)', '\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}'],
          ['Double bars', '\\begin{Vmatrix}#?&#?\\\\#?&#?\\end{Vmatrix}']
        ]
      ],
      [
        'Sparse matrices',
        [
          [
            'n by n, round brackets',
            '\\begin{pmatrix}#?&\\cdots&#?\\\\\\vdots&\\ddots&\\vdots\\\\#?&\\cdots&#?\\end{pmatrix}',
            'w'
          ],
          [
            'n by n, square brackets',
            '\\begin{bmatrix}#?&\\cdots&#?\\\\\\vdots&\\ddots&\\vdots\\\\#?&\\cdots&#?\\end{bmatrix}',
            'w'
          ]
        ]
      ],
      [
        'Common',
        [
          ['Column vector', '\\begin{bmatrix}#?\\\\#?\\\\#?\\end{bmatrix}'],
          ['Row vector', '\\begin{bmatrix}#?&#?&#?\\end{bmatrix}'],
          ['Vector x', '\\begin{bmatrix}x_1\\\\x_2\\\\\\vdots\\\\x_n\\end{bmatrix}'],
          ['Identity in brackets', '\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}']
        ]
      ]
    ]
  ]
];
/* ===== symbols: the strip shows these first (after any pinned), the full gallery all of them by kind. [LaTeX, name] ===== */
export var EQ_STRIP = [
  '\\pm',
  '\\infty',
  '=',
  '\\neq',
  '\\sim',
  '\\times',
  '\\div',
  '!',
  '\\propto',
  '<',
  '\\ll',
  '>',
  '\\gg',
  '\\leq',
  '\\geq',
  '\\mp',
  '\\cong',
  '\\approx',
  '\\equiv',
  '\\forall',
  '\\complement',
  '\\partial',
  '\\sqrt{#0}',
  '\\sqrt[3]{#0}',
  '\\sqrt[4]{#0}',
  '\\cup',
  '\\cap',
  '\\emptyset',
  '\\%',
  '^{\\circ}',
  '{}^{\\circ}\\mathrm{F}',
  '{}^{\\circ}\\mathrm{C}',
  '\\Delta',
  '\\nabla',
  '\\exists',
  '\\nexists',
  '\\in',
  '\\ni'
];
export var EQ_SYMBOLS = [
  [
    'Basic maths',
    [
      ['\\pm', 'plus or minus'],
      ['\\infty', 'infinity'],
      ['=', 'equals'],
      ['\\neq', 'not equal'],
      ['\\sim', 'tilde (distributed as)'],
      ['\\times', 'times'],
      ['\\div', 'divided by'],
      ['!', 'factorial'],
      ['\\propto', 'proportional to'],
      ['<', 'less than'],
      ['\\ll', 'much less than'],
      ['>', 'greater than'],
      ['\\gg', 'much greater than'],
      ['\\leq', 'less than or equal'],
      ['\\geq', 'greater than or equal'],
      ['\\mp', 'minus or plus'],
      ['\\cong', 'congruent'],
      ['\\approx', 'about equal'],
      ['\\equiv', 'identical to'],
      ['\\forall', 'for all'],
      ['\\complement', 'complement'],
      ['\\partial', 'partial'],
      ['\\sqrt{#0}', 'square root'],
      ['\\sqrt[3]{#0}', 'cube root'],
      ['\\sqrt[4]{#0}', 'fourth root'],
      ['\\cup', 'union'],
      ['\\cap', 'intersection'],
      ['\\emptyset', 'empty set'],
      ['\\%', 'percent'],
      ['^{\\circ}', 'degree'],
      ['{}^{\\circ}\\mathrm{F}', 'degrees Fahrenheit'],
      ['{}^{\\circ}\\mathrm{C}', 'degrees Celsius'],
      ['\\Delta', 'increment (delta)'],
      ['\\nabla', 'nabla (gradient)'],
      ['\\exists', 'there exists'],
      ['\\nexists', 'there does not exist'],
      ['\\in', 'is in'],
      ['\\ni', 'contains'],
      ['\\leftarrow', 'left arrow'],
      ['\\uparrow', 'up arrow'],
      ['\\rightarrow', 'right arrow'],
      ['\\downarrow', 'down arrow'],
      ['\\leftrightarrow', 'both ways'],
      ['\\therefore', 'therefore'],
      ['+', 'plus'],
      ['-', 'minus'],
      ['\\neg', 'not'],
      ['\\ast', 'asterisk'],
      ['\\cdot', 'dot (times)'],
      ['\\vdots', 'vertical dots'],
      ['\\cdots', 'centre dots'],
      ['\\ddots', 'diagonal dots'],
      ['\\aleph', 'aleph'],
      ['\\beth', 'beth'],
      ['\\blacksquare', 'end of proof']
    ]
  ],
  [
    'Greek lowercase',
    [
      ['\\alpha', 'alpha'],
      ['\\beta', 'beta'],
      ['\\gamma', 'gamma'],
      ['\\delta', 'delta'],
      ['\\varepsilon', 'epsilon'],
      ['\\epsilon', 'epsilon (lunate)'],
      ['\\zeta', 'zeta'],
      ['\\eta', 'eta'],
      ['\\theta', 'theta'],
      ['\\vartheta', 'theta (script)'],
      ['\\iota', 'iota'],
      ['\\kappa', 'kappa'],
      ['\\lambda', 'lambda'],
      ['\\mu', 'mu'],
      ['\\nu', 'nu'],
      ['\\xi', 'xi'],
      ['o', 'omicron'],
      ['\\pi', 'pi'],
      ['\\varpi', 'pi (variant)'],
      ['\\rho', 'rho'],
      ['\\varrho', 'rho (variant)'],
      ['\\sigma', 'sigma'],
      ['\\varsigma', 'final sigma'],
      ['\\tau', 'tau'],
      ['\\upsilon', 'upsilon'],
      ['\\varphi', 'phi'],
      ['\\phi', 'phi (straight)'],
      ['\\chi', 'chi'],
      ['\\psi', 'psi'],
      ['\\omega', 'omega']
    ]
  ],
  [
    'Greek uppercase',
    [
      ['A', 'Alpha'],
      ['B', 'Beta'],
      ['\\Gamma', 'Gamma'],
      ['\\Delta', 'Delta'],
      ['E', 'Epsilon'],
      ['Z', 'Zeta'],
      ['H', 'Eta'],
      ['\\Theta', 'Theta'],
      ['I', 'Iota'],
      ['K', 'Kappa'],
      ['\\Lambda', 'Lambda'],
      ['M', 'Mu'],
      ['N', 'Nu'],
      ['\\Xi', 'Xi'],
      ['O', 'Omicron'],
      ['\\Pi', 'Pi'],
      ['P', 'Rho'],
      ['\\Sigma', 'Sigma'],
      ['T', 'Tau'],
      ['\\Upsilon', 'Upsilon'],
      ['\\Phi', 'Phi'],
      ['X', 'Chi'],
      ['\\Psi', 'Psi'],
      ['\\Omega', 'Omega']
    ]
  ],
  [
    'Letter-like symbols',
    [
      ['\\mathbb{R}', 'real numbers'],
      ['\\mathbb{N}', 'natural numbers'],
      ['\\mathbb{Z}', 'integers'],
      ['\\mathbb{Q}', 'rationals'],
      ['\\mathbb{C}', 'complex numbers'],
      ['\\mathbb{E}', 'expectation'],
      ['\\mathcal{L}', 'script L (loss)'],
      ['\\mathcal{N}', 'script N (normal)'],
      ['\\mathcal{O}', 'big O'],
      ['\\ell', 'script l'],
      ['\\hbar', 'h-bar'],
      ['\\Re', 'real part'],
      ['\\Im', 'imaginary part'],
      ['\\wp', 'Weierstrass p'],
      ['\\imath', 'dotless i'],
      ['\\jmath', 'dotless j']
    ]
  ],
  [
    'Operators',
    [
      ['\\cdot', 'dot'],
      ['\\circ', 'compose'],
      ['\\bullet', 'bullet'],
      ['\\star', 'star'],
      ['\\oplus', 'circled plus'],
      ['\\ominus', 'circled minus'],
      ['\\otimes', 'circled times (tensor)'],
      ['\\odot', 'circled dot'],
      ['\\oslash', 'circled slash'],
      ['\\wedge', 'and'],
      ['\\vee', 'or'],
      ['\\setminus', 'set minus'],
      ['\\dagger', 'dagger'],
      ['\\amalg', 'amalgamation'],
      ['\\uplus', 'multiset union'],
      ['\\sqcup', 'square union'],
      ['\\sqcap', 'square intersection'],
      ['\\triangleleft', 'triangle left'],
      ['\\triangleright', 'triangle right'],
      ['\\wr', 'wreath']
    ]
  ],
  [
    'Relations',
    [
      ['\\subset', 'subset'],
      ['\\subseteq', 'subset or equal'],
      ['\\supset', 'superset'],
      ['\\supseteq', 'superset or equal'],
      ['\\sqsubseteq', 'square subset'],
      ['\\perp', 'perpendicular'],
      ['\\parallel', 'parallel'],
      ['\\mid', 'divides'],
      ['\\models', 'models'],
      ['\\vdash', 'proves'],
      ['\\simeq', 'similar or equal'],
      ['\\asymp', 'asymptotic'],
      ['\\doteq', 'dot equals'],
      ['\\coloneqq', 'defined as'],
      ['\\triangleq', 'delta equal'],
      ['\\prec', 'precedes'],
      ['\\succ', 'succeeds'],
      ['\\preceq', 'precedes or equal'],
      ['\\succeq', 'succeeds or equal'],
      ['\\lesssim', 'less or similar'],
      ['\\gtrsim', 'greater or similar']
    ]
  ],
  [
    'Arrows',
    [
      ['\\leftarrow', 'left'],
      ['\\rightarrow', 'right'],
      ['\\leftrightarrow', 'both ways'],
      ['\\Leftarrow', 'double left'],
      ['\\Rightarrow', 'implies'],
      ['\\Leftrightarrow', 'if and only if'],
      ['\\uparrow', 'up'],
      ['\\downarrow', 'down'],
      ['\\updownarrow', 'up and down'],
      ['\\mapsto', 'maps to'],
      ['\\longrightarrow', 'long right'],
      ['\\Longrightarrow', 'long implies'],
      ['\\hookrightarrow', 'hook (embeds)'],
      ['\\nearrow', 'north-east'],
      ['\\searrow', 'south-east'],
      ['\\nwarrow', 'north-west'],
      ['\\swarrow', 'south-west'],
      ['\\rightleftharpoons', 'equilibrium'],
      ['\\leftharpoonup', 'harpoon left'],
      ['\\rightharpoonup', 'harpoon right'],
      ['\\circlearrowleft', 'circle left'],
      ['\\circlearrowright', 'circle right']
    ]
  ],
  [
    'Negated relations',
    [
      ['\\neq', 'not equal'],
      ['\\nless', 'not less'],
      ['\\ngtr', 'not greater'],
      ['\\nleq', 'not less or equal'],
      ['\\ngeq', 'not greater or equal'],
      ['\\notin', 'not in'],
      ['\\not\\ni', 'does not contain'],
      ['\\nsubseteq', 'not a subset'],
      ['\\nsupseteq', 'not a superset'],
      ['\\not\\equiv', 'not identical'],
      ['\\ncong', 'not congruent'],
      ['\\nsim', 'not similar'],
      ['\\nmid', 'does not divide'],
      ['\\nparallel', 'not parallel']
    ]
  ],
  [
    'Geometry',
    [
      ['\\angle', 'angle'],
      ['\\measuredangle', 'measured angle'],
      ['\\sphericalangle', 'spherical angle'],
      ['\\triangle', 'triangle'],
      ['\\square', 'square'],
      ['\\Diamond', 'diamond'],
      ['\\bigcirc', 'circle'],
      ['\\perp', 'perpendicular'],
      ['\\parallel', 'parallel'],
      ['\\cong', 'congruent'],
      ['^{\\prime}', 'prime (minutes)'],
      ['^{\\prime\\prime}', 'double prime (seconds)']
    ]
  ]
];
/* ===== the equation gallery: ready-made equations (and the ones you save) ===== */
export var EQ_BUILTIN = [
  ['Area of a circle', 'A=\\pi r^{2}'],
  ['Binomial theorem', '(x+a)^{n}=\\sum_{k=0}^{n}\\binom{n}{k}x^{k}a^{n-k}'],
  ['Expansion of a sum', '(1+x)^{n}=1+\\frac{nx}{1!}+\\frac{n(n-1)x^{2}}{2!}+\\cdots'],
  [
    'Fourier series',
    'f(x)=a_{0}+\\sum_{n=1}^{\\infty}\\left(a_{n}\\cos\\frac{n\\pi x}{L}+b_{n}\\sin\\frac{n\\pi x}{L}\\right)'
  ],
  ['Pythagorean theorem', 'a^{2}+b^{2}=c^{2}'],
  ['Quadratic formula', 'x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'],
  ['Taylor expansion', 'e^{x}=1+\\frac{x}{1!}+\\frac{x^{2}}{2!}+\\frac{x^{3}}{3!}+\\cdots,\\quad -\\infty<x<\\infty'],
  [
    'Trig identity 1',
    '\\sin\\alpha\\pm\\sin\\beta=2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)'
  ],
  ['Trig identity 2', '\\cos\\alpha+\\cos\\beta=2\\cos\\frac{1}{2}(\\alpha+\\beta)\\cos\\frac{1}{2}(\\alpha-\\beta)'],
  ['Mean', '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_{i}'],
  ['Variance', '\\sigma^{2}=\\frac{1}{n}\\sum_{i=1}^{n}\\left(x_{i}-\\bar{x}\\right)^{2}'],
  ['Normal distribution', 'p(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}'],
  ['Bayes’ theorem', 'P(A\\mid B)=\\frac{P(B\\mid A)\\,P(A)}{P(B)}'],
  ['Sigmoid', '\\sigma(z)=\\frac{1}{1+e^{-z}}'],
  ['Softmax', '\\operatorname{softmax}(z)_{k}=\\frac{e^{z_{k}}}{\\sum_{j}e^{z_{j}}}'],
  ['Least squares loss', 'L[\\boldsymbol{\\phi}]=\\sum_{i=1}^{I}\\left(f[x_{i},\\boldsymbol{\\phi}]-y_{i}\\right)^{2}'],
  [
    'Best parameters',
    '\\hat{\\boldsymbol{\\phi}}=\\operatorname*{argmin}_{\\boldsymbol{\\phi}}\\left[L[\\boldsymbol{\\phi}]\\right]'
  ],
  [
    'Gradient descent step',
    '\\boldsymbol{\\phi}\\leftarrow\\boldsymbol{\\phi}-\\alpha\\frac{\\partial L}{\\partial\\boldsymbol{\\phi}}'
  ]
];
export function eqStore(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(KEY + '-eq' + k) || '[]');
    localStorage.setItem(KEY + '-eq' + k, JSON.stringify(v));
  } catch (x) {
    return [];
  }
}
/* a menu tile's picture: the layout with its boxes shown as □ */
export function eqPreview(t) {
  return texInline(String(t).replace(/#[0?]/g, '\\square'));
}
